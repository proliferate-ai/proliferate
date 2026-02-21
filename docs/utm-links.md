# UTM Links

All links use first-touch attribution — whichever link a user clicks first sticks permanently on their PostHog profile.

## Static Placements

Set once, don't change.

| Placement | Link |
|-----------|------|
| Twitter/X bio | `proliferate.com?utm_source=twitter&utm_medium=social&utm_campaign=bio` |
| LinkedIn personal bio | `proliferate.com?utm_source=linkedin&utm_medium=social&utm_campaign=personal-bio` |
| LinkedIn company bio | `proliferate.com?utm_source=linkedin&utm_medium=social&utm_campaign=company-bio` |
| GitHub README | `proliferate.com?utm_source=github&utm_medium=social&utm_campaign=readme` |
| Docs site | `proliferate.com?utm_source=docs&utm_medium=referral&utm_campaign=docs` |
| YC company page | `proliferate.com?utm_source=yc&utm_medium=referral&utm_campaign=profile` |

## Launches

Unique campaign per event — high-signal moments worth tracking individually.

| Placement | Link |
|-----------|------|
| Launch HN post | `proliferate.com?utm_source=hackernews&utm_medium=social&utm_campaign=launch-hn` |
| Launch YC post | `proliferate.com?utm_source=yc&utm_medium=social&utm_campaign=launch-yc` |
| BF post | `proliferate.com?utm_source=bf&utm_medium=social&utm_campaign=launch-bf` |
| Launch tweet | `proliferate.com?utm_source=twitter&utm_medium=social&utm_campaign=launch-tweet` |
| Launch LinkedIn post | `proliferate.com?utm_source=linkedin&utm_medium=social&utm_campaign=launch-post` |

## Comments

Generic per platform — tracking which platform a comment came from is 90% of the value.

| Placement | Link |
|-----------|------|
| Twitter comments | `proliferate.com?utm_source=twitter&utm_medium=social&utm_campaign=comment` |
| LinkedIn comments | `proliferate.com?utm_source=linkedin&utm_medium=social&utm_campaign=comment` |
| HN comments | `proliferate.com?utm_source=hackernews&utm_medium=social&utm_campaign=comment` |

## Conventions

- **`utm_source`** = the platform (twitter, linkedin, hackernews, yc, github, docs)
- **`utm_medium`** = the channel type (social, referral, email, paid)
- **`utm_campaign`** = the specific effort (bio, launch-yc, comment)
- Keep all values **lowercase** and consistent — don't mix `LinkedIn` and `linkedin`
- For big one-off events (launches, partnerships), create a unique `utm_campaign`
- For recurring activities (comments), use the generic platform campaign
