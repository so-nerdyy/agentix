# Phase 11 - Auth and RBAC

## Purpose

Add real access control for the dashboard, bridge, and integrations.

## Scope

- User roles.
- Token/session auth.
- Admin vs operator permissions.
- Approval-bound actions.

## Implementation

- Login/session handling.
- Role checks on protected routes.
- Privilege boundaries for config and execution.

## Acceptance Criteria

- Protected routes reject unauthorized access.
- High-risk actions require proper authorization.

