import shuffle from 'lodash/shuffle'
import select from 'select-dom'
import { MATCH_ROOM_VETO_MAP_ITEMS } from '../../shared/settings'
import storage from '../../shared/storage'
import {
  hasFeatureAttribute,
  setFeatureAttribute
} from '../helpers/dom-element'
import {
  getMatch,
  getPlayerStats,
  getQuickMatch,
  getSelf
} from '../helpers/faceit-api'
import maps from '../helpers/maps'
import { getRoomId, getTeamElements } from '../helpers/match-room'
import { notifyIf } from '../helpers/user-settings'

const FEATURE_ATTRIBUTE = 'veto-maps'
const VETO_DELAY = 2000

export default async parentElement => {
  const { isTeamV1Element } = getTeamElements(parentElement)
  const roomId = getRoomId()
  const match = isTeamV1Element
    ? await getQuickMatch(roomId)
    : await getMatch(roomId)
  const self = await getSelf()

  let faction1Leader
  let faction2Leader

  if (isTeamV1Element) {
    faction1Leader = match.faction1Leader
    faction2Leader = match.faction2Leader
  } else {
    faction1Leader = match.teams.faction1.leader
    faction2Leader = match.teams.faction2.leader
  }

  if (![faction1Leader, faction2Leader].includes(self.id)) {
    return
  }

  const votingListElement = select(
    'div.match-vs__details > div.match-voting > div > democracy',
    parentElement
  )

  if (!votingListElement) {
    return
  }

  let {
    matchRoomAutoVetoMapItems,
    matchRoomAutoVetoMapsShuffle: shuffleMaps,
    matchRoomAutoVetoMapsShuffleAmount: shuffleMapsAmount
  } = await storage.getAll()

  matchRoomAutoVetoMapItems = await getAutoVetoMaps(
    match,
    self.guid === faction1Leader ? 1 : 2
  )

  let autoVetoItems = matchRoomAutoVetoMapItems.map(m => maps.csgo[m] || m)

  if (shuffleMaps) {
    const shuffledItems = shuffle(autoVetoItems.splice(0, shuffleMapsAmount))
    autoVetoItems.unshift(...shuffledItems)
  }

  autoVetoItems = autoVetoItems.reverse()

  const isVetoMaps = autoVetoItems.some(item =>
    select.exists(`div[title="${item}"]`, votingListElement)
  )

  if (
    hasFeatureAttribute(FEATURE_ATTRIBUTE, votingListElement) ||
    !isVetoMaps
  ) {
    return
  }

  setFeatureAttribute(FEATURE_ATTRIBUTE, votingListElement)

  const autoVeto = () => {
    const isVetoTurn = select.exists('button', votingListElement)

    if (!isVetoTurn) {
      return
    }

    autoVetoItems.some(item => {
      const vetoButtonElement = select(
        `div[title="${item}"] * button`,
        votingListElement
      )
      if (vetoButtonElement) {
        setTimeout(() => {
          vetoButtonElement.click()
        }, VETO_DELAY)
      }
      return Boolean(vetoButtonElement)
    })
  }

  autoVeto()

  const observer = new MutationObserver(() => {
    const vetoButtonElements = select.all('button', votingListElement)

    if ([2, 3].includes(vetoButtonElements.length)) {
      observer.disconnect()
    }

    autoVeto()
  })
  observer.observe(votingListElement, { childList: true, subtree: true })

  notifyIf('notifyMatchRoomAutoVetoMaps', {
    title: 'Match Maps Veto',
    message: 'Maps will be vetoed automatically.'
  })
}

export async function getAutoVetoMaps(match, ourFaction) {
  const { faction1, faction2 } = match.teams
  const enemyMapScores = await getMapFactionMapScores(
    ourFaction === 2 ? faction1 : faction2
  )
  console.log('enemy', enemyMapScores)
  const ourMapScores = await getMapFactionMapScores(
    ourFaction === 1 ? faction1 : faction2
  )
  console.log('our', ourMapScores)

  const scores = MATCH_ROOM_VETO_MAP_ITEMS.map((v, i) => [
    ourMapScores[v] - enemyMapScores[v],
    i
  ])
  scores.sort((a, b) => b[0] - a[0])

  const result = scores.map(([_, i]) => MATCH_ROOM_VETO_MAP_ITEMS[i])
  return result
}

async function getMapFactionMapScores(faction) {
  const { roster } = faction

  const result = {}
  for (const map of MATCH_ROOM_VETO_MAP_ITEMS) {
    result[map] = 0
  }

  let totalElo = 0

  for (const member of roster) {
    const { id, elo } = member
    totalElo += elo
    const { winRates } = await getPlayerStats(id, 'csgo')
    for (const map of MATCH_ROOM_VETO_MAP_ITEMS) {
      if (winRates[map]) {
        result[map] += Number(winRates[map]) * elo
      } else {
        result[map] += 50 * elo
      }
    }
  }

  for (const map of MATCH_ROOM_VETO_MAP_ITEMS) {
    result[map] /= totalElo
  }

  return result
}
