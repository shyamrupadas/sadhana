# Triage Labels

The skills use five canonical triage roles. For local tickets, record the matching value in the ticket's status field.

| Role              | Local status      | Meaning                                 |
| ----------------- | ----------------- | --------------------------------------- |
| `needs-triage`    | `needs-triage`    | Maintainer needs to evaluate the ticket |
| `needs-info`      | `needs-info`      | Waiting for more information            |
| `ready-for-agent` | `ready-for-agent` | Ready for agent implementation          |
| `ready-for-human` | `ready-for-human` | Requires human implementation           |
| `wontfix`         | `wontfix`         | Will not be actioned                    |

`awaiting-human-review` is an implementation lifecycle status, not a triage role. It means implementation and required checks are complete and the ticket awaits human review or acceptance.
