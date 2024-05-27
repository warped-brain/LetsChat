#!/bin/bash
set -e
USAGE="Usage: $0 {PACKAGES_BUCKET} {WWW_BUCKET} {STACK_NAME}"
PACKAGES_BUCKET=${1?$USAGE}
WWW_BUCKET=${2?$USAGE}
STACK_NAME=${3?$USAGE}
sam build
sam package --s3-bucket $PACKAGES_BUCKET --output-template-file packaged.yaml
sam deploy --template-file packaged.yaml --stack-name $STACK_NAME --capabilities CAPABILITY_IAM

