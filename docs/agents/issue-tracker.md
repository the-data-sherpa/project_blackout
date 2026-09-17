# Issue tracker: GitHub

Issues and specs live in GitHub Issues for
the-data-sherpa/project_blackout.

Prefer gh-axi for supported GitHub operations; use gh for capabilities
the wrapper does not expose.

- Create issues using a title and --body-file for multiline bodies.
- Read complete issue bodies and comments before working on a ticket.
- Publish tickets in dependency order, blockers first.
- Represent blockers using native GitHub issue dependencies and
  include blocking issue references in each ticket body.
- If native dependencies are unavailable, retain explicit blocking
  references in the body.
- A ticket can start when all its blockers are complete.
- Apply labels using the mapping in triage-labels.md.

PRs as a request surface: no.

When a skill says “publish to the issue tracker,” create a GitHub issue.
When it says “fetch the relevant ticket,” read the issue and comments.
