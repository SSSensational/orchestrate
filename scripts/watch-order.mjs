export function firstOpenIssueNumber(issues) {
  return issues.reduce((first, issue) => first === null || issue.number < first ? issue.number : first, null);
}
