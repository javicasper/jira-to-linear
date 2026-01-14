# Privacy Policy

**Last updated:** January 2025

## Overview

jira-to-linear is a command-line tool that helps migrate issues from Jira to Linear. This privacy policy explains how we handle your data.

## Data Collection

This tool:

- **Does NOT collect** any personal data
- **Does NOT send** data to any third-party servers
- **Does NOT track** usage or analytics

## Data Storage

When you use this tool, your credentials (Jira API token and Linear API key) are stored **locally on your machine** at `~/.jira-to-linear.json`. This file is only accessible to you.

## Data Transmission

The tool only communicates with:

- **Jira API** (`*.atlassian.net`) - to read your issues
- **Linear API** (`api.linear.app`) - to create issues

No data is sent anywhere else.

## Third-Party Services

This tool interacts with:

- Atlassian Jira (subject to [Atlassian's Privacy Policy](https://www.atlassian.com/legal/privacy-policy))
- Linear (subject to [Linear's Privacy Policy](https://linear.app/privacy))

## Data Deletion

To delete all stored data, simply remove the configuration file:

```bash
rm ~/.jira-to-linear.json
```

## Contact

For questions about this privacy policy, please open an issue at:
https://github.com/javicasper/jira-to-linear/issues

## Changes

We may update this privacy policy from time to time. Changes will be posted to this repository.
