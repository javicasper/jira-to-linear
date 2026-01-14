# Support

## Getting Help

If you need help with jira-to-linear, you have the following options:

### GitHub Issues

For bug reports and feature requests, please open an issue:
https://github.com/javicasper/jira-to-linear/issues

### Documentation

See the [README](README.md) for usage instructions and configuration details.

## Frequently Asked Questions

### Where are my credentials stored?

Your Jira and Linear credentials are stored locally at `~/.jira-to-linear.json`. They are never sent to any third-party servers.

### How do I reset my credentials?

Delete the config file and run the tool again:

```bash
rm ~/.jira-to-linear.json
npx @javierlopezr/jira-to-linear
```

### What Jira permissions do I need?

You need read access to the Jira projects you want to migrate.

### What Linear permissions do I need?

Your Linear API key needs permission to create issues and projects.

## Response Time

This is an open-source project maintained in spare time. We'll do our best to respond to issues as quickly as possible.
