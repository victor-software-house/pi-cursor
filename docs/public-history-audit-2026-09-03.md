# Public-history privacy audit

Date: 2026-09-03  
Scope: Git objects reachable from the exact GitHub-visible refs before repository visibility changed

## Result

The reachable history contains no credential, private key, personal filesystem path, private email
address, host machine identifier, account-specific usage capture, non-loopback private network URL, or other
non-public personal data.
It is safe to expose without rewriting history.

## Reachable scope

The remote advertised exactly:

- `refs/heads/main` at `930b110859d4eaaf1743c66d1603609b1912dcff`;
- annotated `refs/tags/v0.0.0`, dereferencing to
  `db907167ecef04b299b6ef572767c973b03934f4`.

There were no remote pull-request, merge-request, notes, or additional branch refs. The union of
`origin/main` and `v0.0.0` contained 33 commits, 427 reachable objects, and 238 distinct text blobs.
The blob scan decoded 1,847,673 bytes; no reachable blob was binary.

Local-only branches, reflogs, and unreachable objects are not advertised by GitHub and were not
included in the public-history conclusion.

## Checks

1. Gitleaks scanned the full 33-commit history with its default rules and recursive decoding. It
   reported no leaks.
2. A second scanner read every reachable blob directly rather than only current files or commit
   diffs. It checked for private-key markers, JWTs, known GitHub/npm/Anthropic/OpenAI token prefixes,
   authorization values, credential assignments, home-directory paths, personal email addresses,
   MAC addresses, private-network URLs, and 1Password/fnox references.
3. All commit author and committer identities were enumerated. They use the public business identity
   `Victor Araújo <victor@victor-software-house.com>`; one tag commit has GitHub's public noreply
   committer.
4. Historical file paths and commit messages were inspected for credentials, account identifiers,
   captured billing data, and machine identity material.
5. The public npm `pi-cursor-inference@0.0.0` placeholder metadata was read independently so an
   identifier already published by npm was not mistaken for a private-history disclosure.

## Candidate disposition

The broad blob scanner deliberately over-matched. Every candidate was classified:

| Candidate class | Disposition |
|:--|:--|
| Business email | The package author and Git identities use the public VSH business address. No personal email domain occurs. |
| Historical npm maintainer handle | Appeared once in an old decision and was later removed from current prose. The same handle is already public in npm's `0.0.0` maintainer metadata; it is not a private disclosure. |
| MAC-address forms | All are Cursor's three documented rejected-address sentinels, including zero and broadcast addresses. No host MAC was recorded. |
| Authorization and credential literals | Synthetic test values such as repeated characters, `HEADER.PAYLOAD.SIGNATURE`, `refresh-token`, and `headless-token`. Gitleaks independently found none to be a secret. |
| UUID forms | Fixed RFC example/test UUIDs and the public Cursor OAuth client identifier. No account or host UUID was recorded. |
| Private-network URLs | Loopback HTTP/2 test servers only. No LAN, tailnet, or internal service URL occurs. |
| Usage IDs and amounts | Synthetic round fixtures (`userId: 777`, `teamId: 4242`, and round percentages/cents) used to test units and arithmetic. No live account value entered Git. |
| Geographic timezone | `America/Sao_Paulo` is a deterministic checksum/transport test input, not captured account or host state. |
| Artifact hashes and source commits | Public Cursor artifact integrity evidence, not machine IDs or credentials. |

## Boundaries

GitHub secret-scanning alerts were unavailable while the repository was private, returning the
platform's “secret scanning is disabled” response. This audit therefore did not treat an empty alert
list as evidence; it used full-history Gitleaks plus direct reachable-blob inspection instead.

The audit establishes the exact pre-publication history above. It does not exempt future commits
from the repository's normal review and verification gates.
