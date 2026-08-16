## Summary

Describe the user-visible change and why it is needed.

## Privacy and model behavior

- [ ] No captured user activity, credentials, or private model inputs are included.
- [ ] Inference changes identify the affected task, input version, prompt version, and provider paths.
- [ ] Structural inference changes preserve all six deterministic request hashes.
- [ ] Intentional model-behavior changes include a baseline comparison and version bump.

## Verification

- [ ] `npm run check`
- [ ] Website checks, if `website/` changed.
- [ ] Live model evaluation, if prompt/input/provider behavior intentionally changed.
