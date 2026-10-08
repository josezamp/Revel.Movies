import { useEffect, useState } from 'react'
import { AnnouncementsPanel } from './AnnouncementsPanel'
import {
  createDisplayGroup,
  deleteDisplayGroup,
  getDisplayGroups,
  replaceDisplayGroupMembers,
  sendGroupCommand,
  type Display,
  type DisplayGroup,
  type MediaAsset,
} from '../api/client'

type Props = {
  eventId: string
  displays: Display[]
  media: MediaAsset[]
  onGroupsChanged: (groups: DisplayGroup[]) => void
}

export function OrchestrationPanel({ eventId, displays, media, onGroupsChanged }: Props) {
  const [groups, setGroups] = useState<DisplayGroup[]>([])
  const [groupMedia, setGroupMedia] = useState<Record<string, string>>({})
  const displayMembershipKey = displays.map((display) => display.id).sort().join(',')

  async function refresh() {
    if (!eventId) {
      setGroups([])
      onGroupsChanged([])
      return
    }

    const nextGroups = await getDisplayGroups(eventId)
    setGroups(nextGroups)
    onGroupsChanged(nextGroups)
  }

  useEffect(() => {
    void refresh()
  }, [eventId, displayMembershipKey])

  async function createGroup() {
    const name = window.prompt('Group name', 'Living')
    if (!name || !eventId) return
    await createDisplayGroup(eventId, name)
    await refresh()
  }

  async function toggleGroupMember(group: DisplayGroup, displayId: string) {
    const displayIds = group.displayIds.includes(displayId)
      ? group.displayIds.filter((id) => id !== displayId)
      : [...group.displayIds, displayId]

    await replaceDisplayGroupMembers(group.id, displayIds)
    await refresh()
  }

  async function removeGroup(group: DisplayGroup) {
    if (!window.confirm(`Delete group ${group.name}?`)) return
    await deleteDisplayGroup(group.id)
    await refresh()
  }

  async function playMediaOnGroup(group: DisplayGroup) {
    const mediaId = groupMedia[group.id] || media[0]?.id
    if (!mediaId) return
    await sendGroupCommand(group.id, 'media.play', { mediaId })
  }

  return (
    <>
      <AnnouncementsPanel eventId={eventId} displays={displays} groups={groups} />
      <section>
        <div className="section-heading">
          <div>
            <h2>Display Groups</h2>
            <p className="muted">Control several screens as one target.</p>
          </div>
          <button disabled={!eventId} onClick={() => void createGroup()}>New group</button>
        </div>

        {groups.length === 0 && <p className="muted">No display groups for this event yet.</p>}
        <div className="card-grid orchestration-grid">
          {groups.map((group) => (
            <article className="card" key={group.id}>
              <div className="display-heading">
                <strong>{group.name}</strong>
                <span className="count-badge">{group.displayIds.length} screens</span>
              </div>

              <div className="member-list">
                {displays.map((display) => (
                  <label key={display.id}>
                    <input
                      type="checkbox"
                      checked={group.displayIds.includes(display.id)}
                      onChange={() => void toggleGroupMember(group, display.id)}
                    />
                    {display.name}
                  </label>
                ))}
                {displays.length === 0 && <small className="muted">No displays available.</small>}
              </div>

              <div className="inline-control">
                <select
                  value={groupMedia[group.id] ?? media[0]?.id ?? ''}
                  onChange={(event) => setGroupMedia((current) => ({ ...current, [group.id]: event.target.value }))}
                >
                  {media.length === 0 && <option value="">No media</option>}
                  {media.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                <button disabled={group.displayIds.length === 0 || media.length === 0} onClick={() => void playMediaOnGroup(group)}>▶ Play</button>
              </div>

              <div className="button-row">
                <button disabled={group.displayIds.length === 0} onClick={() => void sendGroupCommand(group.id, 'display.identify')}>Identify</button>
                <button disabled={group.displayIds.length === 0} onClick={() => void sendGroupCommand(group.id, 'display.blackout')}>Blackout</button>
                <button disabled={group.displayIds.length === 0} onClick={() => void sendGroupCommand(group.id, 'media.stop')}>Stop</button>
                <button className="danger-button" onClick={() => void removeGroup(group)}>Delete</button>
              </div>
            </article>
          ))}
        </div>
      </section>

    </>
  )
}
