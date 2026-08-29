---
"prism-gen3": patch
---

No code changes — the AMO JWT credentials had become invalid (beta.28/beta.29 both shipped with an unsigned Firefox zip fallback, "Unknown JWT iss" from AMO), and have now been regenerated and updated in the repo secrets. This release exercises the signing path again to confirm the new credentials actually work and this ships with a real signed `.xpi`.
