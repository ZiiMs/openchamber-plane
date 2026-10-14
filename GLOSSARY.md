# OpenChamber-Plane

Bridge between OpenChamber sessions and Plane work tracking.

## Language

**Work item**:
The unit of tracked work in Plane.
_Avoid_: Issue, ticket

**Workspace slug**:
The URL-safe key identifying a Plane workspace.
_Avoid_: Workspace id, workspace name

**Work item identifier**:
The human-readable work-item key, project prefix plus sequence number.
_Avoid_: UUID, id

**State**:
The named workflow position a work item sits in, defined per project, e.g. "In Progress".
_Avoid_: Status, state name, state group

**State group**:
The fixed workflow bucket a state belongs to, stable across projects.
_Avoid_: State name, status
