// gather NYPD NCO assignments

const fs = require('fs').promises
const fetch = require('node-fetch')
const d3 = require('d3')

const files = {
  pct:     'pct-ncos.js',
  psa:     'psa-ncos.js',
  transit: 'transit-ncos.csv',
  all:     'ncos.json'
}

const source = {
  pct:     'https://www1.nyc.gov/assets/nypd/js/ncos.js', // pct-ncos.js
  psa:     'https://www1.nyc.gov/assets/nypd/js/psa-ncos.js', // psa-ncos.js
  transit: 'https://www1.nyc.gov/assets/nypd/data/transit.csv' // transit-ncos.csv
}

async function fetchFiles() {
  let data = {}

  for await (let key of Object.keys(source)) {
    const response = await fetch(source[key])
    const text = await response.text()
    await fs.writeFile(files[key], text)
    data[key] = text
  }

  return data
}

function parsePct(data) {
  const lines = data.split(/\r?\n/)
  return lines.map(line => {
    let record = parseArray(line)
    if (record?.command) {
      record.command = convertCommand(record.command)
    }
    return record
  }).filter(Boolean)
}

function parsePsa(data) {
  const lines = data.split(/\r?\n/)
  return lines.map(line => {
    return parseArray(line)
  }).filter(Boolean)
}

async function parseTransit(data) {
  let ncos = []
  let records = await d3.csvParse(data, function(entry) {
    return {
      command: entry['DISTRICT'], // ex. TD 33
      sector: entry['SECTOR'],
      borough: entry['Borough'],
      x: entry['X'],
      y: entry['Y'],
      line: entry['LINE'],
      location: entry['NAME'],
      station_id: entry['STATION_ID'],
      mta: {
        last_name: entry['MTA LAST NAME'],
        first_name: entry['MTA FIRST NAME'],
        title: entry['MTA TITLE'],
        email: entry['MTA EMAIL']
      },
      nco1: {
        last_name: entry['NCO 1 LAST NAME'],
        first_name: entry['NCO 1 FIRST NAME'],
        rank: entry['NCO'],
        email: entry['NCO 1 EMAIL']
      },
      nco2: {
        last_name: entry['NCO 2 LAST NAME'],
        first_name: entry['NCO 2 FIRST NAME'],
        rank: entry['NCO '], // has SPACE
        email: entry['NCO 2 EMAIL']
      },
      sgt: {
        last_name: entry['SGT LAST NAME'],
        first_name: entry['SGT FIRST NAME'],
        rank: entry['SGT'].trim(),
        email: entry['SGT EMAIL']
      }
    }
  })

  records.forEach(record => {
    let props = ['nco1','nco2','sgt']
    props.forEach(() => {
      let entry = {
        command: record.command,
        sector: record.sector,
        ...record.nco1,
        ...record
      }
      let command = entry.command.padStart(2, '0')
      command = `TB DT${command}`
      entry.command = command

      props.forEach(prop => { delete entry[prop] })

      ncos.push(entry)
    })
  })

  return ncos
}

async function saveAll(ncos) {
  await fs.writeFile(files.all, JSON.stringify(ncos, null, 2))
}

function parseArray(line) {
  const match = line.match(/ = \[(.*)\]/)
  if (!match || !match[1]) { return }

  let [command, sector, rank, first_name, last_name, email] = match[1].split('","')

  if (!command || !rank || !first_name || !last_name || !email) {
    return
  }
  if (first_name === "VACANT" || last_name === "VACANT") {
    return
  }

  command = command.replace(/"/g, '')
  email = email.replace(/"/g, '')

  return {
    command,
    sector,
    last_name,
    first_name,
    rank,
    email
  }
}

function convertCommand(command) {
  if (command === '18') { return 'MTN PCT' }
  if (command === '14') { return 'MTS PCT' }
  let pct = command.padStart(3, '0')
  pct = `${pct} PCT`
  return pct
}

function normalize(ncos) {
  // sort by command -> sector -> name
  ncos.sort((a, b) => {
    let acmd = a.command
    let bcmd = b.command
    if (acmd === 'MTN PCT') { acmd = '018 PCT' }
    if (bcmd === 'MTN PCT') { bcmd = '018 PCT' }
    if (acmd === 'MTS PCT') { acmd = '014 PCT' }
    if (bcmd === 'MTS PCT') { bcmd = '014 PCT' }

    if (acmd < bcmd) return -1
    if (acmd > bcmd) return 1

    if (a.sector < b.sector) return -1
    if (a.sector > b.sector) return 1

    if (a.last_name < b.last_name) return -1
    if (a.last_name > b.last_name) return 1

    if (a.first_name < b.first_name) return -1
    if (a.first_name > b.first_name) return 1

    return 0
  })

  return ncos.map(nco => {
    nco.rank = nco.rank.toUpperCase()
    nco.command = nco.command.toUpperCase()
    nco.email = nco.email.toLowerCase()

    if (nco.mta?.email) { nco.mta.email = nco.mta.email.toLowerCase() }
    if (nco.mta?.title) { nco.mta.email = nco.mta.title.toUpperCase() }

    if (nco.first_name === nco.first_name.toUpperCase()) {
      nco.first_name = capitalize(nco.first_name)
    }
    if (nco.last_name === nco.last_name.toUpperCase()) {
      nco.last_name = capitalize(nco.last_name)
    }
    return nco
  })
}

function capitalize(str) {
  return str.split(' ').map(entry => {
    return entry.charAt(0).toUpperCase() + entry.slice(1).toLowerCase()
  }).join(' ')
}

async function start() {
  let ncos = []
  const data = await fetchFiles()

  let entries = parsePct(data.pct)
  ncos.push(...entries)

  entries = parsePsa(data.psa)
  ncos.push(...entries)

  entries = await parseTransit(data.transit)
  ncos.push(...entries)

  ncos = normalize(ncos)

  await saveAll(ncos)
}

start()
