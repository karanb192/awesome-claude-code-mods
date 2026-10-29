(() => {
  const copyCommand = document.getElementById('finder-copy')
  const copyStatus = document.getElementById('finder-copy-status')
  document.querySelector('.finder-command-actions').hidden = false
  copyCommand.addEventListener('click', async () => {
    copyStatus.textContent = ''
    copyCommand.disabled = true
    try {
      await navigator.clipboard.writeText(document.getElementById('finder-command').textContent)
      copyStatus.textContent = 'Copied.'
    } catch {
      copyStatus.textContent = 'Copy failed. Select the command and copy it manually.'
    } finally {
      copyCommand.disabled = false
    }
  })

  const q = document.getElementById('q')
  const count = document.getElementById('n')
  const tbody = document.querySelector('#t tbody')
  let rows = [...tbody.rows]
  const filters = [...document.querySelectorAll('.lv[data-level]')]
  const listedFilter = document.querySelector('.listed-filter')
  const reset = document.getElementById('reset')
  const searchPanel = document.querySelector('.catalog-search')
  const table = document.getElementById('t')
  const clearSearch = document.getElementById('clear-search')
  let level = ''
  let listed = false
  let loaded = false
  let failed = false
  let order = null
  // The latest #slug navigation lands once the list loads, unless the reader used the directory after it.
  let target = location.hash.slice(1)
  let used = false
  for (const type of ['input', 'click', 'focusin']) document.getElementById('directory').addEventListener(type, () => { used = true }, true)

  function apply() {
    const search = q.value.trim().toLowerCase()
    let visible = 0
    for (const row of rows) {
      row.hidden = !((level === '' || row.dataset.level === level) && (!listed || row.dataset.listed === '1') && (!search || row.dataset.name.toLowerCase().includes(search)))
      if (!row.hidden) visible++
    }
    // While the rest of the list loads only the first rows are on the page: say so, and do not claim an empty result.
    const pending = !loaded && !failed
    if (pending) count.textContent = search || level || listed ? `${visible} of the first ${rows.length} mods, loading the rest` : `${table.dataset.total} mods`
    else count.textContent = visible === rows.length ? `${rows.length} mods` : `${visible} of ${rows.length} mods`
    for (const filter of filters) filter.setAttribute('aria-pressed', String(filter.dataset.level === level))
    listedFilter.setAttribute('aria-pressed', String(listed))
    reset.hidden = !search && !level && !listed
    clearSearch.hidden = q.value.length === 0
    document.getElementById('empty').hidden = visible !== 0 || pending
  }

  function clear() {
    q.value = ''
    level = ''
    listed = false
    apply()
  }

  function showResults() {
    const top = window.scrollY + table.getBoundingClientRect().top - searchPanel.offsetHeight - 12
    window.scrollTo({ top, behavior: 'instant' })
  }

  function updateResults() {
    const readingRows = table.getBoundingClientRect().top < searchPanel.getBoundingClientRect().bottom
    apply()
    if (readingRows) showResults()
  }

  for (const filter of filters) filter.addEventListener('click', () => {
    level = level === filter.dataset.level ? '' : filter.dataset.level
    updateResults()
  })
  listedFilter.addEventListener('click', () => {
    listed = !listed
    updateResults()
  })
  for (const button of document.querySelectorAll('#reset, [data-reset]')) button.addEventListener('click', () => {
    clear()
    showResults()
    q.focus({ preventScroll: true })
  })
  q.addEventListener('input', updateResults)
  clearSearch.addEventListener('click', () => {
    q.value = ''
    updateResults()
    q.focus({ preventScroll: true })
  })
  document.querySelector('.search').addEventListener('submit', event => {
    event.preventDefault()
    showResults()
    q.focus({ preventScroll: true })
  })
  for (const link of document.querySelectorAll('a[href="#directory"], a[href="#about"], a[href="#method"]')) link.addEventListener('click', event => {
    event.preventDefault()
    const section = document.getElementById(link.hash.slice(1))
    history.replaceState(null, '', link.hash)
    if (!loaded && !failed) { target = section.id; used = false }
    const top = window.scrollY + section.getBoundingClientRect().top
    window.scrollTo({ top, behavior: 'instant' })
    const heading = section.id === 'directory' ? q : section.querySelector('h2')
    if (heading !== q) heading.tabIndex = -1
    heading.focus({ preventScroll: true })
  })
  function sortRows() {
    const { key, direction } = order
    rows.sort((a, b) => {
      if (key === 'level' && (a.dataset.level === 'unknown') !== (b.dataset.level === 'unknown')) return a.dataset.level === 'unknown' ? 1 : -1
      const comparison = key === 'stars' ? Number(a.dataset.stars) - Number(b.dataset.stars) : key === 'level' ? Number(a.dataset.level) - Number(b.dataset.level) || Number(b.dataset.stars) - Number(a.dataset.stars) : a.dataset.name.localeCompare(b.dataset.name)
      return direction === 'asc' ? comparison : -comparison
    })
    tbody.append(...rows)
  }
  for (const button of document.querySelectorAll('#t th button')) button.addEventListener('click', () => {
    const direction = button.dataset.dir === 'asc' ? 'desc' : 'asc'
    document.querySelectorAll('#t th').forEach(th => th.removeAttribute('aria-sort'))
    button.dataset.dir = direction
    button.closest('th').setAttribute('aria-sort', direction === 'asc' ? 'ascending' : 'descending')
    order = { key: button.dataset.k, direction }
    sortRows()
  })

  function reveal(id, scroll = true) {
    const row = document.getElementById(id)
    if (!row || !rows.includes(row)) return
    clear()
    if (scroll) row.scrollIntoView({ block: 'center' })
    row.querySelector('.mod-name').focus({ preventScroll: true })
  }
  window.addEventListener('hashchange', () => {
    if (loaded || failed) return arrive(location.hash.slice(1))
    target = location.hash.slice(1)
    used = false
  })

  // The full list moves everything below the table, so a #section or built-in arrival scrolls again once it is in.
  function arrive(id) {
    const target = document.getElementById(id)
    if (!target || rows.includes(target)) return reveal(id)
    for (let details = target.closest('details'); details; details = details.parentElement.closest('details')) details.open = true
    target.scrollIntoView({ block: target.closest('tbody') ? 'center' : 'start', behavior: 'instant' })
  }

  function start() {
    for (const segment of document.querySelectorAll('.seg')) segment.addEventListener('click', event => {
      event.preventDefault()
      history.replaceState(null, '', segment.getAttribute('href'))
      reveal(segment.hash.slice(1))
    })
    apply()
    if (!used && target) arrive(target)
    else if (!used && query) document.getElementById('directory').scrollIntoView({ block: 'start', behavior: 'instant' })
    table.dataset.loaded = 'true'
  }

  // Read the URL's search before loading, so anything typed while the list loads is not replaced by it.
  const query = new URLSearchParams(location.search).get('q')
  if (query) q.value = query
  apply()

  // The page ships the first rows only; the full list and the access strip arrive in parts. If any part fails,
  // search covers the rows on the page and a note points to the A to Z pages.
  const snapshot = table.dataset.snapshot
  Promise.all(Array.from({ length: Number(table.dataset.parts) }, (_, i) => fetch(`directory/${i + 1}.json?v=${snapshot}`)
    .then(response => { if (!response.ok) throw new Error(String(response.status)); return response.json() })
    .then(part => { if (part.snapshot !== snapshot) throw new Error('mixed directory versions'); return part })))
    .then(list => ({ rows: list.flatMap(part => part.rows), strip: list.map(part => part.strip).join('') }))
    .then(data => {
      // A pending navigation takes focus after loading, so only restore focus when there is none.
      const active = !used && target ? null : document.activeElement
      const focused = active?.closest('#t tbody tr')
      const at = focused ? [...focused.querySelectorAll('a, button')].indexOf(active) : -1
      tbody.innerHTML = data.rows.join('\n')
      rows = [...tbody.rows]
      loaded = true
      if (order) sortRows()
      if (focused) document.getElementById(focused.id)?.querySelectorAll('a, button')[at]?.focus({ preventScroll: true })
      document.querySelector('.strip').innerHTML = data.strip
    })
    .catch(() => {
      failed = true
      document.getElementById('load-note').hidden = false
      document.getElementById('strip-note').hidden = false
      const empty = document.getElementById('empty')
      empty.querySelector('h3').textContent = 'No match among the mods on this page.'
      empty.querySelector('p').textContent = 'The full list did not load, so search covers the most-starred mods only. Browse every mod from A to Z.'
    })
    .finally(start)
})()
