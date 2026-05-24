# oTutorHub Custom Commands for Claude Code

## /fix [description]
Full cycle: plan → implement → test → review → push
```
1. Read CLAUDE.md
2. Act as Architect: analyze, plan
3. Act as Developer: implement
4. Act as Tester: verify + write test
5. Act as Reviewer: review diff
6. Push to main if all checks pass
7. Report to Oksana in Ukrainian
```

## /audit
Run all quality checks and report:
```bash
npx tsc --noEmit
npm run test
node scripts/check-i18n.mjs
node scripts/check-hardcode.mjs
node scripts/check-ux.mjs
```
Report each result with ✅/❌ and specific issues.

## /test-flow [flow-name]
Run E2E test for a specific user flow:
- tutor-onboarding
- tutor-create-lesson
- manager-dashboard
- student-dashboard
- chat-context

## /deploy
Check CI status → push to main → confirm Lovable started building

## /status
Report current state:
- Last commit
- CI status
- Known bugs backlog
- What's in progress

## /add-feature [description]
Full feature cycle:
1. Architect: design the feature, check for conflicts
2. Show design to Oksana for approval
3. Developer: implement
4. Tester: write E2E test
5. Reviewer: approve
6. Push

## /review-pr
Review current uncommitted changes as if it were a PR.
