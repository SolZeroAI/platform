# Security Policy

Security is a core requirement for SolZero. If you believe you have found a vulnerability, please report
it privately so we can investigate before details are made public.

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/SolZeroAI/platform/security/advisories/new)
to submit a report. Please do not open a public issue for a suspected vulnerability.

Include the following when possible:

- The affected component and version or commit
- Steps to reproduce the issue
- The potential impact
- Any suggested mitigation

Do not include live credentials, private keys, production data, or other secrets. We will acknowledge
the report, coordinate next steps with you, and publish an advisory when a fix is ready if appropriate.

## Supported versions

Security fixes are made on the default branch and included in the next release. The latest tagged
release receives security updates. Older release lines are unsupported unless a security advisory
states otherwise.

| Version         | Supported |
| --------------- | --------- |
| Latest release  | Yes       |
| Default branch  | Yes       |
| Older releases  | No        |

## Scope

Reports about SolZero source code and the default deployment architecture are in scope. Reports about a
third-party service or an organization's deployment should be sent to that service or organization
unless the issue is caused by SolZero.
