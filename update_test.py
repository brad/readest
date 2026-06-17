import sys

with open('apps/readest-app/src/__tests__/helpers/updater.test.ts', 'r') as f:
    content = f.read()

content = content.replace("getAppVersion: () => mockAppVersion,", "getAppVersion: () => mockAppVersion,\n  isNightly: () => mockAppVersion.includes('nightly'),")

with open('apps/readest-app/src/__tests__/helpers/updater.test.ts', 'w') as f:
    f.write(content)
