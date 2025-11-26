#!/usr/bin/env python3
import os
import aws_cdk as cdk
from landslide_stack import LandslideStack

app = cdk.App()

# ---------- STANDALONE MODE ----------
# Creates its own VPC with NAT Gateway
# Deploy this NOW, get approval later

LandslideStack(
    app,
    "LandslideStack",
    use_existing_vpc=False,  # flag for using or not the shared VPC
    env=cdk.Environment(
        account=os.environ.get('CDK_DEFAULT_ACCOUNT'),
        region=os.environ.get('CDK_DEFAULT_REGION', 'us-west-2'),
    ),
)

app.synth()