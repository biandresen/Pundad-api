# Issue tracker: GitHub

Issues and specs live in GitHub Issues for biandresen/Blog-API.
Use the gh CLI from this repository.

## Conventions

- Create: gh issue create --title "..." --body-file <file>
- Read: gh issue view <number> --json number,title,body,labels,comments
- List: gh issue list --state open --json number,title,body,labels
- Comment: gh issue comment <number> --body-file <file>
- Apply labels: gh issue edit <number> --add-label "..."
- Remove labels: gh issue edit <number> --remove-label "..."
- Close: gh issue close <number> --comment "..."

Write multiline issue bodies and comments to a temporary file,
then pass it with --body-file.

Infer the repository from the Git remote. When operating outside
the checkout, specify --repo biandresen/Blog-API.

## Skill terminology

“Publish to the issue tracker” means create a GitHub issue.
“Fetch the relevant ticket” means read the corresponding issue.

## Relationships

Use GitHub sub-issues for parent/child relationships and native
issue dependencies for blockers where available.

Otherwise, add children to a task list in the parent issue,
start each child with “Part of #<parent>”, and record blockers
with “Blocked by: #<number>”.

## Pull requests as a triage surface

PRs as a request surface: no.

## Wayfinding

A map is an issue labelled wayfinder:map.
Its child tickets use wayfinder:research, wayfinder:prototype,
wayfinder:grilling, or wayfinder:task.

Choose open, unassigned children with no open blockers in map order.
Claim a ticket by assigning it to the driving developer.
On resolution, comment with the result, close the ticket, and
append a short result and link to the map's Decisions-so-far.
