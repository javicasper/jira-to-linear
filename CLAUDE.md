# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A Node.js CLI tool that migrates Jira stories and subtasks to Linear. It provides an interactive workflow with prompts for selecting Jira projects, filtering stories, and choosing Linear team destinations. The UI is in Spanish.

## Running the Tool

```bash
node jira-to-linear.mjs
```

No build step required. The project uses ES modules (`.mjs`).

## Required Environment Variables (.env)

```
JIRA_BASE_URL=https://[instance].atlassian.net
JIRA_EMAIL=[email]
JIRA_API_TOKEN=[token]
LINEAR_API_KEY=[key]
```

## Architecture

Single-file architecture (`jira-to-linear.mjs`, ~420 lines) with these components:

**Jira Integration:**
- `jiraGET(path, params)` - HTTP wrapper with auth and error handling
- `listJiraProjects()` - Fetches projects with pagination
- `jiraSearchIssues(jql, fields)` - JQL-based search with fallback endpoints (`/search` → `/search/jql`)
- `getJiraIssue(keyOrId, fields)` - Single issue fetch

**Content Transformation:**
- `adfToMarkdown(adf)` - Converts Jira's Atlassian Document Format to Markdown (paragraphs, headings, lists, code blocks, marks). Falls back to JSON code block for unsupported structures.

**Migration Workflow (`main()`):**
1. User selects Jira project via interactive prompt
2. Optional filtering for non-finalized stories (or custom JQL)
3. User multi-selects stories to migrate
4. User selects Linear team and optional project
5. For each story: fetch details → convert ADF → create Linear issue with Jira reference header
6. Process subtasks as child issues (linked via `parentId`)

**Key Patterns:**
- Inquirer.js for interactive CLI prompts
- Map structure for Jira key → Linear ID relationship tracking
- Header injection in Linear descriptions with audit trail back to Jira
- Per-story error handling (continues migration on individual failures)
