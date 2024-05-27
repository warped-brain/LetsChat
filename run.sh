#!/bin/bash
set -e
USAGE="Usage: $0 {PACKAGES_BUCKET} {WWW_BUCKET} {STACK_NAME}"
PACKAGES_BUCKET=${1?$USAGE}
WWW_BUCKET=${2?$USAGE}
STACK_NAME=${3?$USAGE}
sam build
sam package --s3-bucket $PACKAGES_BUCKET --output-template-file packaged.yaml
sam deploy --template-file packaged.yaml --stack-name $STACK_NAME --capabilities CAPABILITY_IAM
aws cloudformation describe-stacks --stack-name $STACK_NAME --query 'Stacks[0].Outputs[?OutputKey==`WebSocketURI`]'.OutputValue --output text >> wss-uri.txt
aws s3 cp index.js s3://$WWW_BUCKET/
aws s3 cp index.html s3://$WWW_BUCKET/
aws s3 cp wss-uri.txt s3://$WWW_BUCKET/