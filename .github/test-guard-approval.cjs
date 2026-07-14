'use strict';

const AUTHORIZED_HUMAN_USER_IDS = new Set([
  37439786, // SSSensational (CODEOWNER); login is documentation only.
]);

function hasAuthorizedTestChangeApproval(events) {
  return Array.isArray(events) && events.some((event) =>
    event?.event === 'labeled' &&
    event.label?.name === 'approved-test-change' &&
    event.actor?.type === 'User' &&
    Number.isInteger(event.actor.id) &&
    AUTHORIZED_HUMAN_USER_IDS.has(event.actor.id));
}

module.exports = { hasAuthorizedTestChangeApproval };
