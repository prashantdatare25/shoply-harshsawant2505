"""
review_agent.py
This script runs inside GitHub Actions when a student submits a PR.

Features:
- Reads PR metadata from GITHUB_EVENT_PATH
- Fetches changed files only
- Fetches README + docs
- Sends content to OpenAI LLM for code review
- AI returns: summary, issues[], score, verdict
- Auto-merges if score >= 80
- Rejects PR otherwise
"""

import os
import json
import re
import base64
from github import Github
import openai

# ----------------------------------------------------------------------------
# Environment Variables
# ----------------------------------------------------------------------------

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
BOT_PAT = os.getenv("BOT_PAT")
EVENT_PATH = os.getenv("GITHUB_EVENT_PATH")

if not OPENAI_API_KEY:
    raise Exception("OPENAI_API_KEY missing from Secrets")

if not BOT_PAT:
    raise Exception("BOT_PAT missing from Secrets")

if not EVENT_PATH:
    raise Exception("GITHUB_EVENT_PATH not provided")

openai.api_key = OPENAI_API_KEY

# GitHub Client using BOT PAT (full repo permissions)
github_client = Github(BOT_PAT)

# Load GitHub event
with open(EVENT_PATH, "r") as f:
    event = json.load(f)

pr = event.get("pull_request")
repo_info = event.get("repository")

if not pr:
    raise Exception("Not a pull_request event")

owner = repo_info["owner"]["login"]
repo_name = repo_info["name"]
pr_number = pr["number"]

repo = github_client.get_repo(f"{owner}/{repo_name}")
pull = repo.get_pull(pr_number)

print(f"🔍 Running AI review on PR #{pr_number}")

# ----------------------------------------------------------------------------
# Step 1 — Collect changed files
# ----------------------------------------------------------------------------

changed_files = []
for file in pull.get_files():
    file_path = file.filename

    try:
        # Try to get file content from PR branch
        gh_file = repo.get_contents(file_path, ref=pull.head.ref)
        content = gh_file.decoded_content.decode("utf-8", errors="ignore")
    except:
        content = f"Could not read file: {file_path}"

    changed_files.append({
        "filename": file_path,
        "status": file.status,
        "content": content
    })

print(f"📄 Found {len(changed_files)} changed files.")

# ----------------------------------------------------------------------------
# Step 2 — Read documentation (README + docs/)
# ----------------------------------------------------------------------------

docs_text = ""

# README.md
try:
    readme = repo.get_readme()
    docs_text += "\n# README.md\n" + readme.decoded_content.decode()
except:
    docs_text += "\n(No README found)\n"

# docs folder
try:
    docs_dir = repo.get_contents("docs", ref=pull.head.ref)
    if isinstance(docs_dir, list):
        for item in docs_dir:
            if item.type == "file":
                docs_text += f"\n\n# {item.path}\n"
                docs_text += repo.get_contents(item.path, ref=pull.head.ref).decoded_content.decode()
except:
    docs_text += "\n(No docs/ folder)\n"

# ----------------------------------------------------------------------------
# Step 3 — Build AI prompt
# ----------------------------------------------------------------------------

prompt = f"""
You are an expert senior code reviewer.

TASK:
- Evaluate the PR changes against the project documentation (below).
- Check quality, correctness, clarity, consistency, and requirements.
- Identify issues or missing logic.
- Provide a score (0–100).
- Provide brief, actionable issues.

RETURN JSON ONLY:

{{
  "summary": "short summary",
  "issues_found": ["issue1", "issue2"],
  "score": 0,
  "verdict": "ACCEPTED" or "REJECTED"
}}

SCORING:
- 80–100 → ACCEPTED (auto-merge)
- 0–79 → REJECTED

-------------------------------------------------------------------------------
DOCUMENTATION:
{docs_text}
-------------------------------------------------------------------------------
CHANGED FILES:
"""

for f in changed_files:
    prompt += f"\n\n--- FILE: {f['filename']} ({f['status']}) ---\n{f['content']}\n"

# ----------------------------------------------------------------------------
# Step 4 — Call OpenAI LLM
# ----------------------------------------------------------------------------

print("🤖 Contacting OpenAI...")

response = openai.ChatCompletion.create(
    model="gpt-4o-mini",  # or "gpt-4o" if you want higher quality
    messages=[
        {"role": "system", "content": "You are a strict code reviewer."},
        {"role": "user", "content": prompt}
    ],
    temperature=0.1,
    max_tokens=2000
)

raw_output = response["choices"][0]["message"]["content"].strip()

# Extract JSON
match = re.search(r"\{.*\}", raw_output, re.S)
if not match:
    raise Exception("Model did not return JSON format:\n" + raw_output)

result = json.loads(match.group(0))

score = int(result.get("score", 0))
verdict = result.get("verdict", "REJECTED")

print(f"AI Score: {score}, Verdict: {verdict}")

# ----------------------------------------------------------------------------
# Step 5 — Post PR comment
# ----------------------------------------------------------------------------

issues_md = "\n".join([f"- {i}" for i in result["issues_found"]])

comment_body = f"""
### 🤖 AI Review Result

**Score:** {score}/100  
**Verdict:** **{verdict}**

**Summary:**  
{result['summary']}

**Issues Found:**  
{issues_md}
"""

pull.create_issue_comment(comment_body)
print("💬 Added PR review comment.")

# ----------------------------------------------------------------------------
# Step 6 — Auto-merge or reject PR
# ----------------------------------------------------------------------------

if score >= 80 and verdict.upper() == "ACCEPTED":
    try:
        pull.merge(
            merge_method="squash",
            commit_message=f"Auto-merged by AI Reviewer (score: {score})"
        )
        print("✅ Auto-merged PR!")
    except Exception as e:
        print("❌ Merge failed:", e)
        pull.create_issue_comment(f"⚠️ Auto-merge failed: {str(e)}")
else:
    # Add rejection label
    try:
        label = repo.get_label("rejected")
    except:
        label = repo.create_label("rejected", "FF0000", "AI rejected this PR")

    pull.add_to_labels(label)
    print("❌ PR rejected (score below threshold).")
