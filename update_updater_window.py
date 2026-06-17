import sys

with open('apps/readest-app/src/components/UpdaterWindow.tsx', 'r') as f:
    content = f.read()

content = content.replace("import { getAppVersion } from '@/utils/version';", "import { getAppVersion, isNightly } from '@/utils/version';")
content = content.replace("import { READEST_UPDATER_FILE, READEST_CHANGELOG_FILE } from '@/services/constants';",
                         "import {\n  READEST_UPDATER_FILE,\n  READEST_CHANGELOG_FILE,\n  GITHUB_NIGHTLY_RELEASES_API,\n} from '@/services/constants';")

new_get_updater_url = """    const getUpdaterUrl = async () => {
      if (!isNightly()) return READEST_UPDATER_FILE;
      try {
        const fetch = isTauriAppPlatform() ? tauriFetch : window.fetch;
        const res = await fetch(GITHUB_NIGHTLY_RELEASES_API);
        const releases = await res.json();
        const latestNightly = releases.find((r: { tag_name: string; assets: { name: string; browser_download_url: string }[] }) => r.tag_name && r.tag_name.startsWith('nightly-'));
        if (latestNightly) {
          const latestJsonAsset = latestNightly.assets.find((a: { name: string; browser_download_url: string }) => a.name === 'latest.json');
          if (latestJsonAsset) {
            return latestJsonAsset.browser_download_url;
          }
        }
      } catch (e) {
        console.error('Failed to fetch nightly updater URL:', e);
      }
      return READEST_UPDATER_FILE;
    };
"""

content = content.replace("    const checkAndroidUpdate = async () => {", new_get_updater_url + "    const checkAndroidUpdate = async () => {")
content = content.replace("const response = await fetch(READEST_UPDATER_FILE);", "const updaterUrl = await getUpdaterUrl();\n      const response = await fetch(updaterUrl);")

# APK download URL logic for nightly
old_download_url = "const downloadUrl = data.platforms[platformKey]?.url as string;"
new_download_url = """let downloadUrl = data.platforms[platformKey]?.url as string;
        if (downloadUrl === 'GITHUB_ASSET_URL_PLACEHOLDER_UNIVERSAL' || downloadUrl === 'GITHUB_ASSET_URL_PLACEHOLDER_ARM64') {
           try {
             const fetch = isTauriAppPlatform() ? tauriFetch : window.fetch;
             const res = await fetch(GITHUB_NIGHTLY_RELEASES_API);
             const releases = await res.json();
             const latestNightly = releases.find((r: { tag_name: string; assets: { name: string; browser_download_url: string }[] }) => r.tag_name && r.tag_name.startsWith('nightly-'));
             if (latestNightly) {
               const apkAsset = latestNightly.assets.find(
                 (a: { name: string; browser_download_url: string }) => a.name.includes(arch) && a.name.endsWith('.apk'),
               );
               if (apkAsset) downloadUrl = apkAsset.browser_download_url;
             }
           } catch (e) { console.error(e); }
        }"""
content = content.replace(old_download_url, new_download_url)

with open('apps/readest-app/src/components/UpdaterWindow.tsx', 'w') as f:
    f.write(content)
