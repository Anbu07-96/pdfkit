# PDFKit — Git Workflow & Safety Rules for Arena Sessions

## Mandatory Rules for All Arena AI Sessions

1. **No Previous Chat Memory**:
   - Never rely on previous Arena chat history or assume context persisted outside the repository.
   - The git repository state and `.arena/` files are the authoritative source of truth.

2. **Session Initial Verification**:
   Before performing any work, always execute and inspect:
   ```bash
   git status
   git branch --show-current
   git log --oneline --decorate -10
   git remote -v
   ```

3. **Strict Branch Discipline**:
   - **Fixed Session Branch**: Remain on `arena/01a0360f-pdfkit` unless explicitly instructed otherwise by the user.
   - **Never Switch Branches**: Do not switch to `main` or create new branches without explicit instruction.
   - **Never Delete Branches**: Do not delete local or remote branches.

4. **Git History Preservation**:
   - **Zero History Rewriting**: Never run `git reset`, `git rebase`, `git commit --amend`, `git push --force`, or `git filter-branch`.
   - **No Direct Merges to Main**: Never merge directly into `main` locally or push directly to `main`.
   - **No GitHub Settings Changes**: Never alter repository configuration, branch protection rules, or secrets.

5. **Pre-Commit Quality Gate Rules**:
   Before creating any local commit, execute quality gates in exact order:
   ```bash
   npm test
   npm run lint
   NEXT_TELEMETRY_DISABLED=1 npm run build
   npm run typecheck
   ```
   - Run `git diff --check` to verify no whitespace errors exist.
   - Ensure `npm run lint` produces 0 errors (pre-existing warnings in `page-numbers.test.ts` and `tools/index.ts` are preserved).

6. **Commit & Reporting Conventions**:
   - Make single, focused commits per phase (e.g. `feat: implement Phase XX - description`).
   - Always report the exact local commit SHA, current branch, and clean working tree status after committing.

7. **Push & Synchronization Safety**:
   - Verify local branch matches the target remote branch before pushing (`git push -u origin arena/01a0360f-pdfkit`).
   - Never assume GitHub is synchronized with local work.
   - If `git push` fails due to GitHub App token workflow permissions (e.g. `.github/workflows/ci.yml`), notify the user to reconnect GitHub in Arena.

8. **Conflict Resolution**:
   - If repository state conflicts with documentation, **git repository state wins**. Update the `.arena/` documentation to match actual code reality.

9. **Phase Progression**:
   - **Phase 45 must NOT be started automatically.** Wait for explicit user instructions before beginning new phases.
