from aws_cdk import (
    Stack,
    Duration,
    RemovalPolicy,
    aws_ec2 as ec2,
    aws_rds as rds,
    aws_ecs as ecs,
    aws_ecs_patterns as ecs_patterns,
    aws_ecr as ecr,
    aws_iam as iam,
    aws_s3 as s3,
    aws_cloudfront as cloudfront,
    aws_cloudfront_origins as origins,
    aws_s3_deployment as s3_deployment,
    aws_secretsmanager as secretsmanager,
)
from constructs import Construct


class LandslideStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # ---------- VPC ----------
        vpc = ec2.Vpc(
            self, "Vpc",
            max_azs=2,
            nat_gateways=1,
        )

        # ---------- RDS Postgres ----------
        db_secret = rds.DatabaseSecret(
            self, "DbSecret",
            username="postgres",
        )

        db_sg = ec2.SecurityGroup(
            self, "DbSecurityGroup",
            vpc=vpc,
            description="Postgres ingress from ECS",
            allow_all_outbound=True,
        )

        db = rds.DatabaseInstance(
            self, "Postgres",
            engine=rds.DatabaseInstanceEngine.postgres(
                version=rds.PostgresEngineVersion.V16
            ),
            vpc=vpc,
            vpc_subnets=ec2.SubnetSelection(
                subnet_type=ec2.SubnetType.PRIVATE_WITH_EGRESS
            ),
            credentials=rds.Credentials.from_secret(db_secret),
            multi_az=False,
            allocated_storage=50,
            max_allocated_storage=200,
            instance_type=ec2.InstanceType.of(
                ec2.InstanceClass.BURSTABLE3, ec2.InstanceSize.SMALL
            ),
            security_groups=[db_sg],
            removal_policy=RemovalPolicy.SNAPSHOT,
            deletion_protection=True,
            database_name="gis",  # or whatever you use
        )

        # ---------- ECS Cluster ----------
        cluster = ecs.Cluster(
            self, "EcsCluster",
            vpc=vpc,
        )

        # ECR repo you push Martin to
        martin_repo = ecr.Repository.from_repository_name(
            self, "MartinRepo", "martin"  # name in ECR
        )

        # ---------- Martin Fargate Service + ALB ----------
        martin_service = ecs_patterns.ApplicationLoadBalancedFargateService(
            self, "MartinService",
            cluster=cluster,
            cpu=512,
            memory_limit_mib=1024,
            desired_count=1,
            public_load_balancer=True,
            task_image_options=ecs_patterns.ApplicationLoadBalancedTaskImageOptions(
                image=ecs.ContainerImage.from_ecr_repository(martin_repo, "latest"),
                container_port=3000,  # whatever Martin listens on
                environment={
                    "PGHOST": db.db_instance_endpoint_address,
                    "PGDATABASE": "gis",
                    "PGUSER": "postgres",
                    # PGPASSWORD handled below via secret
                },
                secrets={
                    "PGPASSWORD": ecs.Secret.from_secrets_manager(
                        db_secret, field="password"
                    )
                },
            ),
        )

        # Allow ECS tasks to reach Postgres
        db.connections.allow_default_port_from(
            martin_service.service,
            "Allow Martin ECS service to access Postgres"
        )

        # ---------- Existing S3 bucket for Vite app ----------
        site_bucket = s3.Bucket.from_bucket_name(
            self,
            "ExistingHostingBucket",
            "crescent-react-hosting",
        )

        # ---------- CloudFront distribution ----------
        # Default behavior: serve React app from S3 at /landslide-viewer
        # Additional behavior: /tiles/* -> Martin ALB (vector tiles)
        distribution = cloudfront.Distribution(
            self, "LandslideViewerDist",
            default_behavior=cloudfront.BehaviorOptions(
                origin=origins.S3Origin(
                    site_bucket,
                    origin_path="/landslide-viewer",  # folder in the bucket
                ),
                viewer_protocol_policy=cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            ),
            additional_behaviors={
                "/tiles/*": cloudfront.BehaviorOptions(
                    origin=origins.HttpOrigin(
                        domain_name=martin_service.load_balancer.load_balancer_dns_name,
                        protocol_policy=cloudfront.OriginProtocolPolicy.HTTP_ONLY,
                    ),
                    viewer_protocol_policy=cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    cache_policy=cloudfront.CachePolicy.CACHING_OPTIMIZED,
                    origin_request_policy=cloudfront.OriginRequestPolicy.ALL_VIEWER,
                )
            },
        )

        # ---------- Deploy Vite dist/ to the subfolder ----------
        # After running `npm run build` locally or in CI, this will upload ./dist
        # to s3://crescent-react-hosting/landslide-viewer/
        s3_deployment.BucketDeployment(
            self, "DeployLandslideViewer",
            sources=[s3_deployment.Source.asset("./dist")],
            destination_bucket=site_bucket,
            destination_key_prefix="landslide-viewer",
            distribution=distribution,
            distribution_paths=["/*"],
        )
