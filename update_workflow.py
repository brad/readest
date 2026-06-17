import sys

with open('.github/workflows/nightly-android.yml', 'r') as f:
    content = f.read()

old_block = """          # Sign the APKs
          pnpm tauri signer sign ${universal_apk}
          pnpm tauri signer sign ${arm64_apk}

          cd ../../
          tag_name="nightly-$date_suffix\""""

new_block = """          # Sign the APKs
          pnpm tauri signer sign ${universal_apk}
          pnpm tauri signer sign ${arm64_apk}

          # Generate latest.json
          universal_sig=$(cat ${universal_apk}.sig)
          arm64_sig=$(cat ${arm64_apk}.sig)
          jq -n \\
            --arg version "$version" \\
            --arg notes "Nightly build from develop branch. Built on $(date)" \\
            --arg pub_date "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" \\
            --arg univ_sig "$universal_sig" \\
            --arg arm64_sig "$arm64_sig" \\
            '{
              version: $version,
              notes: $notes,
              pub_date: $pub_date,
              platforms: {
                "android-universal": { signature: $univ_sig, url: "GITHUB_ASSET_URL_PLACEHOLDER_UNIVERSAL" },
                "android-arm64": { signature: $arm64_sig, url: "GITHUB_ASSET_URL_PLACEHOLDER_ARM64" }
              }
            }' > latest.json

          cd ../../
          tag_name="nightly-$date_suffix\""""

content = content.replace(old_block, new_block)

old_gh_create = """          gh release create "$tag_name" \\
            apps/readest-app/${universal_apk} \\
            apps/readest-app/${arm64_apk} \\
            apps/readest-app/${universal_apk}.sig \\
            apps/readest-app/${arm64_apk}.sig \\"""

new_gh_create = """          gh release create "$tag_name" \\
            apps/readest-app/${universal_apk} \\
            apps/readest-app/${arm64_apk} \\
            apps/readest-app/${universal_apk}.sig \\
            apps/readest-app/${arm64_apk}.sig \\
            apps/readest-app/latest.json \\"""

content = content.replace(old_gh_create, new_gh_create)

with open('.github/workflows/nightly-android.yml', 'w') as f:
    f.write(content)
