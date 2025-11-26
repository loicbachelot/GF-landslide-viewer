from aws_cdk import (
    Stack,
    Duration,
    RemovalPolicy,
    Fn,
    CfnOutput,
    Size,
    aws_ec2 as ec2,
    aws_rds as rds,
    aws_ecs as ecs,
    aws_ecs_patterns as ecs_patterns,
    aws_ecr as ecr,
    aws_s3 as s3,
    aws_cloudfront as cloudfront,
    aws_cloudfront_origins as origins,
    aws_lambda as _lambda,
    aws_apigateway as apigw,
    aws_iam as iam,
    aws_dynamodb as dynamodb,
    aws_sqs as sqs,
    aws_lambda_event_sources as lambda_events
)
from constructs import Construct


class LandslideStack(Stack):
    """
    Landslide viewer stack.

    DEPLOY MODE: Set use_existing_vpc=False for standalone, True for shared VPC
    """

    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        use_existing_vpc: bool = False,
        existing_vpc_id: str = None,
        **kwargs
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # ---------- VPC Setup (Standalone or Shared) ----------
        if use_existing_vpc and existing_vpc_id:
            # SHARED MODE: Use existing VPC
            vpc = ec2.Vpc.from_lookup(
                self, "ExistingVpc",
                vpc_id=existing_vpc_id,
            )

            # Add S3 endpoint (safe to call even if exists)
            vpc.add_gateway_endpoint(
                "S3Endpoint",
                service=ec2.GatewayVpcEndpointAwsService.S3,
            )

            print(f"Using existing VPC: {existing_vpc_id}")
        else:
            # STANDALONE MODE: Create own VPC with NAT
            vpc = ec2.Vpc(
                self, "LandslideVpc",
                max_azs=2,
                nat_gateways=1,
            )

            # Add S3 endpoint
            vpc.add_gateway_endpoint(
                "S3Endpoint",
                service=ec2.GatewayVpcEndpointAwsService.S3,
            )

            print("Creating standalone VPC with NAT Gateway")

        # ---------- RDS Postgres ----------
        db_secret = rds.DatabaseSecret(
            self, "DbSecret",
            username="postgres",
        )

        db_sg = ec2.SecurityGroup(
            self, "DbSecurityGroup",
            vpc=vpc,
            description="Postgres ingress from ECS and Lambda",
            allow_all_outbound=False,
        )

        db = rds.DatabaseInstance(
            self, "Postgres",
            engine=rds.DatabaseInstanceEngine.postgres(
                version=rds.PostgresEngineVersion.VER_16_11
            ),
            vpc=vpc,
            vpc_subnets=ec2.SubnetSelection(
                subnet_type=ec2.SubnetType.PRIVATE_WITH_EGRESS
            ),
            credentials=rds.Credentials.from_secret(db_secret),
            multi_az=False,
            allocated_storage=20,
            max_allocated_storage=50,
            instance_type=ec2.InstanceType.of(
                ec2.InstanceClass.BURSTABLE3,
                ec2.InstanceSize.SMALL
            ),
            security_groups=[db_sg],
            removal_policy=RemovalPolicy.SNAPSHOT,
            deletion_protection=False,
            database_name="gis",
            backup_retention=Duration.days(7),
        )

        # ---------- ECS Cluster ----------
        cluster = ecs.Cluster(
            self, "EcsCluster",
            vpc=vpc,
            container_insights=False,
        )

        martin_repo = ecr.Repository.from_repository_name(
            self, "MartinRepo", "martin"
        )

        # ---------- Martin Fargate Service + ALB ----------
        password_dynamic_ref = (
            f"{{{{resolve:secretsmanager:{db_secret.secret_arn}:SecretString:password}}}}"
        )

        # Full DATABASE_URL with *placeholder* that CloudFormation resolves at runtime
        database_url = (
            f"postgresql://postgres:{password_dynamic_ref}"
            f"@{db.db_instance_endpoint_address}/gis?sslmode=require"
        )

        martin_service = ecs_patterns.ApplicationLoadBalancedFargateService(
            self, "MartinService",
            cluster=cluster,
            cpu=256,
            memory_limit_mib=512,
            desired_count=1,
            public_load_balancer=True,
            task_image_options=ecs_patterns.ApplicationLoadBalancedTaskImageOptions(
                image=ecs.ContainerImage.from_ecr_repository(martin_repo, "latest"),
                container_port=3000,
                environment={
                    "DATABASE_URL": database_url,
                    "RUST_LOG": "info",
                },
            ),
            health_check_grace_period=Duration.seconds(60),
        )

        martin_service.target_group.configure_health_check(
            path="/health",
            interval=Duration.seconds(60),
            timeout=Duration.seconds(30),
            healthy_threshold_count=2,
            unhealthy_threshold_count=3,
        )

        db.connections.allow_default_port_from(
            martin_service.service,
            "Allow Martin ECS service to access Postgres"
        )

        # ---------- S3 bucket for downloads / exports ----------
        export_bucket = s3.Bucket(
            self, "LandslideExportBucket",
            removal_policy=RemovalPolicy.DESTROY,
            auto_delete_objects=True,
            lifecycle_rules=[
                s3.LifecycleRule(
                    id="DeleteOldExports",
                    expiration=Duration.days(1),
                    enabled=True,
                )
            ],
        )

        export_origin = origins.S3BucketOrigin.with_origin_access_control(
            export_bucket,
        )

        # ---------- Async job store (DynamoDB) ----------
        jobs_table = dynamodb.Table(
            self, "JobsTable",
            partition_key=dynamodb.Attribute(
                name="jobId",
                type=dynamodb.AttributeType.STRING,
            ),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            removal_policy=RemovalPolicy.DESTROY,
            time_to_live_attribute="ttl",  # optional but handy
        )

        # ---------- Async job queue (SQS) ----------
        jobs_queue = sqs.Queue(
            self, "JobsQueue",
            visibility_timeout=Duration.minutes(15),
            retention_period=Duration.days(1),
        )

        # ---------- Lambda for /api/count and /api/download ----------

        # ----------  (API layer only) ----------
        download_api_lambda = _lambda.Function(
            self, "DownloadApiLambdaV2",
            runtime=_lambda.Runtime.PYTHON_3_12,
            handler="lambda_main.lambda_handler",
            code=_lambda.Code.from_asset("../download_api"),
            timeout=Duration.seconds(10),
            memory_size=256,
            environment={
                "JOBS_TABLE_NAME": jobs_table.table_name,
                "JOBS_QUEUE_URL": jobs_queue.queue_url,
                "EXPORT_BUCKET": export_bucket.bucket_name,
            },
        )

        jobs_table.grant_read_write_data(download_api_lambda)
        jobs_queue.grant_send_messages(download_api_lambda)

        #------------- lambda worker

        download_lambda_sg = ec2.SecurityGroup(
            self, "DownloadLambdaSG",
            vpc=vpc,
            description="Security group for download Worker Lambda",
            allow_all_outbound=True,
        )

        db.connections.allow_default_port_from(
            download_lambda_sg,
            "Allow download Worker Lambda to access Postgres"
        )

        download_worker_lambda = _lambda.Function(
            self, "DownloadWorkerLambdaV2",
            runtime=_lambda.Runtime.PYTHON_3_12,
            handler="worker_main.lambda_handler",
            code=_lambda.Code.from_asset("../download_api"),
            vpc=vpc,
            vpc_subnets=ec2.SubnetSelection(
                subnet_type=ec2.SubnetType.PRIVATE_WITH_EGRESS
            ),
            security_groups=[download_lambda_sg],
            timeout=Duration.minutes(15),   # long-running allowed
            memory_size=1024,
            ephemeral_storage_size=Size.gibibytes(2), # allowing to write "big" tmp files
            environment={
                "PGHOST": db.db_instance_endpoint_address,
                "PGDATABASE": "gis",
                "PGUSER": "postgres",
                "DB_SECRET_ARN": db_secret.secret_arn,
                "EXPORT_BUCKET": export_bucket.bucket_name,
                "JOBS_TABLE_NAME": jobs_table.table_name,
            },
        )

        db_secret.grant_read(download_worker_lambda)
        export_bucket.grant_read_write(download_worker_lambda)
        jobs_table.grant_read_write_data(download_worker_lambda)
        jobs_queue.grant_consume_messages(download_worker_lambda)

        download_worker_lambda.add_event_source(
            lambda_events.SqsEventSource(
                jobs_queue,
                batch_size=1,
            )
        )

        # ---------- API Gateway ----------
        download_api = apigw.RestApi(
            self, "DownloadApi",
            rest_api_name="LandslideDownloadApi",
            deploy_options=apigw.StageOptions(
                stage_name="prod",
                throttling_rate_limit=50,
                throttling_burst_limit=100,
            ),
        )

        api_root = download_api.root.add_resource("api")

        # /api/count
        count_resource = api_root.add_resource("count")
        count_resource.add_method(
            "POST",
            apigw.LambdaIntegration(download_api_lambda),
            method_responses=[
                apigw.MethodResponse(
                    status_code="202",
                    response_parameters={
                        "method.response.header.Access-Control-Allow-Origin": True,
                    },
                )
            ],
        )
        count_resource.add_cors_preflight(
            allow_origins=["*"],
            allow_methods=["POST", "OPTIONS", "GET"],
        )

        # /api/count/{jobId} for polling
        count_status_resource = count_resource.add_resource("{jobId}")
        count_status_resource.add_method(
            "GET",
            apigw.LambdaIntegration(download_api_lambda),
            method_responses=[
                apigw.MethodResponse(
                    status_code="200",
                    response_parameters={
                        "method.response.header.Access-Control-Allow-Origin": True,
                    },
                )
            ],
        )

        # /api/download
        download_resource = api_root.add_resource("download")
        download_resource.add_method(
            "POST",
            apigw.LambdaIntegration(download_api_lambda),
            method_responses=[
                apigw.MethodResponse(
                    status_code="202",
                    response_parameters={
                        "method.response.header.Access-Control-Allow-Origin": True,
                    },
                )
            ],
        )
        download_resource.add_cors_preflight(
            allow_origins=["*"],
            allow_methods=["POST", "OPTIONS", "GET"],
        )

        # /api/download/{jobId} for polling
        download_status_resource = download_resource.add_resource("{jobId}")
        download_status_resource.add_method(
            "GET",
            apigw.LambdaIntegration(download_api_lambda),
            method_responses=[
                apigw.MethodResponse(
                    status_code="200",
                    response_parameters={
                        "method.response.header.Access-Control-Allow-Origin": True,
                    },
                )
            ],
        )

        # ---------- S3 bucket for Vite app ----------

        site_bucket = s3.Bucket.from_bucket_name(
            self,
            "ExistingHostingBucket",
            "crescent-react-hosting",
        )

        api_domain_name = Fn.select(2, Fn.split("/", download_api.url))

        # ---------- CloudFront ----------

        site_origin = origins.S3BucketOrigin.with_origin_access_control(
            site_bucket,
            origin_path="/landslide-viewer",
        )

        tiles_behavior = cloudfront.BehaviorOptions(
            origin=origins.HttpOrigin(
                domain_name=martin_service.load_balancer.load_balancer_dns_name,
                protocol_policy=cloudfront.OriginProtocolPolicy.HTTP_ONLY,
            ),
            viewer_protocol_policy=cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            cache_policy=cloudfront.CachePolicy.CACHING_DISABLED,
            origin_request_policy=cloudfront.OriginRequestPolicy.ALL_VIEWER,
            allowed_methods=cloudfront.AllowedMethods.ALLOW_GET_HEAD,
            compress=True,
        )

        api_behavior = cloudfront.BehaviorOptions(
            origin=origins.HttpOrigin(
                domain_name=api_domain_name,
                origin_path="/prod",
                protocol_policy=cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
            ),
            viewer_protocol_policy=cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            cache_policy=cloudfront.CachePolicy.CACHING_DISABLED,
            allowed_methods=cloudfront.AllowedMethods.ALLOW_ALL,
            compress=True,
        )

        exports_behavior = cloudfront.BehaviorOptions(
            origin=export_origin,
            viewer_protocol_policy=cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            cache_policy=cloudfront.CachePolicy.CACHING_DISABLED,
            allowed_methods=cloudfront.AllowedMethods.ALLOW_GET_HEAD,
            compress=True,
        )

        distribution = cloudfront.Distribution(
            self, "LandslideViewerDist",
            default_behavior=cloudfront.BehaviorOptions(
                origin=site_origin,
                viewer_protocol_policy=cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                cache_policy=cloudfront.CachePolicy.CACHING_OPTIMIZED,
                allowed_methods=cloudfront.AllowedMethods.ALLOW_ALL,
            ),
            additional_behaviors={
                "/ls_*": tiles_behavior,
                "/api/*": api_behavior,
                "/exports/*": exports_behavior,
            },
            price_class=cloudfront.PriceClass.PRICE_CLASS_100,
            comment="Landslide Viewer - Research Project",
        )


        #######  Policy management  ##########

        site_bucket.add_to_resource_policy(
            iam.PolicyStatement(
                sid="AllowCloudFrontReadLandslideViewerFromCdkDist",
                effect=iam.Effect.ALLOW,
                actions=["s3:GetObject"],
                principals=[iam.ServicePrincipal("cloudfront.amazonaws.com")],
                resources=[
                    f"arn:aws:s3:::{site_bucket.bucket_name}/landslide-viewer/*"
                ],
                conditions={
                    "StringEquals": {
                        "AWS:SourceArn": f"arn:aws:cloudfront::{self.account}:distribution/{distribution.distribution_id}"
                    }
                },
            )
        )

        # ---------- Outputs ----------
        CfnOutput(
            self, "VpcMode",
            value="Standalone VPC" if not use_existing_vpc else f"Shared VPC ({existing_vpc_id})",
            description="VPC deployment mode",
        )

        CfnOutput(
            self, "CloudFrontUrl",
            value=f"https://{distribution.domain_name}",
            description="Main application URL",
        )

        CfnOutput(
            self, "MartinAlbUrl",
            value=f"http://{martin_service.load_balancer.load_balancer_dns_name}",
            description="Direct Martin ALB URL (for debugging)",
        )

        CfnOutput(
            self, "ApiGatewayUrl",
            value=download_api.url,
            description="Direct API Gateway URL",
        )

        CfnOutput(
            self, "DatabaseEndpoint",
            value=db.db_instance_endpoint_address,
            description="RDS Postgres endpoint",
        )

        CfnOutput(
            self, "ExportBucketName",
            value=export_bucket.bucket_name,
            description="S3 bucket for data exports",
        )