(() => {
  const q = document.getElementById('q')
  const count = document.getElementById('n')
  const tbody = document.querySelector('#t tbody')
  const rows = [...tbody.rows]
  const filters = [...document.querySelectorAll('.lv[data-level]')]
  const listedFilter = document.querySelector('.listed-filter')
  const reset = document.getElementById('reset')
  const searchPanel = document.querySelector('.catalog-search')
  const table = document.getElementById('t')
  const clearSearch = document.getElementById('clear-search')
  let level = ''
  let listed = false

  function apply() {
    const search = q.value.trim().toLowerCase()
    let visible = 0
    for (const row of rows) {
      row.hidden = !((level === '' || row.dataset.level === level) && (!listed || row.dataset.listed === '1') && (!search || row.dataset.name.toLowerCase().includes(search)))
      if (!row.hidden) visible++
    }
    count.textContent = visible === rows.length ? `${rows.length} mods` : `${visible} of ${rows.length} mods`
    for (const filter of filters) filter.setAttribute('aria-pressed', String(filter.dataset.level === level))
    listedFilter.setAttribute('aria-pressed', String(listed))
    reset.hidden = !search && !level && !listed
    clearSearch.hidden = q.value.length === 0
    document.getElementById('empty').hidden = visible !== 0
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
    const top = window.scrollY + section.getBoundingClientRect().top
    window.scrollTo({ top, behavior: 'instant' })
    const target = section.id === 'directory' ? q : section.querySelector('h2')
    if (target !== q) target.tabIndex = -1
    target.focus({ preventScroll: true })
  })
  for (const button of document.querySelectorAll('#t th button')) button.addEventListener('click', () => {
    const key = button.dataset.k
    const direction = button.dataset.dir === 'asc' ? 'desc' : 'asc'
    document.querySelectorAll('#t th').forEach(th => th.removeAttribute('aria-sort'))
    button.dataset.dir = direction
    button.closest('th').setAttribute('aria-sort', direction === 'asc' ? 'ascending' : 'descending')
    rows.sort((a, b) => {
      const comparison = key === 'stars' ? Number(a.dataset.stars) - Number(b.dataset.stars) : key === 'level' ? Number(a.dataset.level) - Number(b.dataset.level) || Number(b.dataset.stars) - Number(a.dataset.stars) : a.dataset.name.localeCompare(b.dataset.name)
      return direction === 'asc' ? comparison : -comparison
    })
    tbody.append(...rows)
  })

  function reveal(id, scroll = true) {
    const row = document.getElementById(id)
    if (!row || !rows.includes(row)) return
    clear()
    if (scroll) row.scrollIntoView({ block: 'center' })
    row.querySelector('.mod-name').focus({ preventScroll: true })
  }
  for (const segment of document.querySelectorAll('.seg')) segment.addEventListener('click', event => {
    event.preventDefault()
    history.replaceState(null, '', segment.getAttribute('href'))
    reveal(segment.hash.slice(1))
  })
  window.addEventListener('hashchange', () => reveal(location.hash.slice(1)))
  const query = new URLSearchParams(location.search).get('q')
  if (query) q.value = query
  apply()
  if (location.hash) reveal(location.hash.slice(1))
})()
