---
"prism-gen3": patch
---

Fixed AMO signing failing on every release after the first: WXT strips the `-beta.N` prerelease suffix when generating the manifest's `version` field, so every beta build produced the identical `"0.3.0"` — AMO correctly rejected each subsequent signing attempt as a duplicate version. The manifest version is now a proper 4-segment number that changes every beta (`0.3.0.20` for beta.20, etc.), with the full original version string preserved as `version_name` for display in about:addons/chrome://extensions. Also hardened the release workflow so a signing failure (rate limit, AMO downtime) no longer takes the entire release down with it — it now falls back to the unsigned zip instead of failing before the release is even created.
