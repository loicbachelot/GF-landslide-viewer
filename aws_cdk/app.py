#!/usr/bin/env python3
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
        account="YOUR_ACCOUNT_ID",  # Replace with your AWS account ID
        region="us-west-2",
    ),
)

app.synth()