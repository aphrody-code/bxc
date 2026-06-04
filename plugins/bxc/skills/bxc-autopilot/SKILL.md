---
name: bxc Autopilot & Autonomy
description: This skill should be used for the autopilot loop (scripts/autopilot.sh), scoped verify + lint to avoid global noise, monitor feeding, subagent spawning, PLAN.md / MEGA-PLAN.md management, continuous "YOLO" operation without human in the loop, and log-based coordination.
version: 0.1.0
---

Key: always scope the verify/lint commands to the feature packages + relevant src (see the bxc-verify command and verify-enforcer agent).

The loop reads PLAN.md, runs scoped checks, appends to log, sleeps.

Use for any long-running autonomous development or maintenance of bxc-like projects.
