# Security Policy

## Supported versions

We provide security updates for the latest minor release. Older versions may
receive critical fixes at the maintainers' discretion.

| Version | Supported |
| --- | --- |
| Latest (v0.x) | ✅ |
| Older releases | ⚠️ critical only |

## Reporting a vulnerability

If you discover a security vulnerability, please **do not open a public
issue**. Instead, report it privately:

1. Open a [new security advisory](https://github.com/traceplay/traceplay/security/advisories/new)
   on GitHub (preferred), or
2. Email the maintainers with the subject line `[traceplay security]`.

Include as much detail as possible:

- A description of the vulnerability and its potential impact
- Steps to reproduce (a minimal cassette + suite YAML if applicable)
- The affected version(s)
- Any suggested remediation (optional)

We will acknowledge your report within 72 hours and aim to provide a
timeline for a fix within one week.

## What we ask

- Do not disclose the vulnerability publicly until we have had a chance to
  address it.
- Do not use the vulnerability to access or modify data that does not belong
  to you.
- Follow responsible disclosure practices.

## Scope

This policy covers the traceplay source code, CLI, and GitHub Action. It does
not cover third-party LLM providers or agent frameworks that traceplay
integrates with.
