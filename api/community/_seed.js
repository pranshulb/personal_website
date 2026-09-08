// Seed list — merged into the map whenever the map holds no seed entries
// (empty, wiped, or only ever approved-through-the-admin; see withSeed in
// _store.js), and written into the store alongside the first approval, edit
// or removal after that. Once written, the blob is the source of truth and
// edits here change nothing until the map has no seed entries again.
//
// The rules for these entries are the rules for every entry: the note is
// Pranshul's or it is empty, and area / tags / when come from him. The tags
// here are the first sort he asked for, not a claim about the place — he
// retags in the admin. Addresses and links were verified by web search in
// September 2026 (the evidence is in the session notes, not here); pins were
// placed from the verified street address, two of them from published
// coordinates, so "save and look the pin up again" in the admin re-places
// any that look off. A thing that happens somewhere regular (a monthly night
// at Newspeak House, a weekly club at SET Social) is pinned at that venue.
// Entries without a fixed venue (a meetup that moves around, a network, a
// house) have no pin on purpose, not because one is missing.
//
// Written top-to-bottom in the order the page shows them. The page lists the
// stored order newest-first, so the export is reversed.
const IN_PAGE_ORDER = [
  // ---- places with a door ----
  { id: 'seed-newspeak-house', name: 'Newspeak House', area: 'Bethnal Green',
    tags: ['community', 'tech', 'talk'], note: '', url: 'https://newspeak.house/', when: '',
    lat: 51.5252, lng: -0.0714 },
  { id: 'seed-viktor-wynd', name: 'The Viktor Wynd Museum of Curiosities', area: 'Hackney',
    tags: ['curiosities', 'art'], note: '', url: 'https://thelasttuesdaysociety.org/museum/', when: '',
    lat: 51.5335, lng: -0.0588 },
  { id: 'seed-london-centre-for-book-arts', name: 'London Centre for Book Arts', area: 'Hackney Wick',
    tags: ['making', 'books', 'workshop'], note: '', url: 'https://londonbookarts.org/', when: '',
    lat: 51.5389, lng: -0.0227 },
  { id: 'seed-libreria', name: 'Libreria', area: 'Spitalfields',
    tags: ['books'], note: '', url: 'https://libreria.io/', when: '',
    lat: 51.5203, lng: -0.0706 },
  { id: 'seed-damsel-collective', name: 'Damsel Collective', area: 'Shoreditch',
    tags: ['community', 'food'], note: '', url: 'https://www.damselcollective.com/', when: '',
    lat: 51.5296, lng: -0.0772 },
  { id: 'seed-st-katharine', name: 'Royal Foundation of St Katharine', area: 'Limehouse',
    tags: ['community', 'talk'], note: '', url: 'https://www.rfsk.org.uk/events', when: '',
    lat: 51.5117, lng: -0.0372 },
  { id: 'seed-morocco-bound', name: 'Morocco Bound Bookshop', area: 'Bermondsey',
    tags: ['books'], note: '', url: 'https://www.moroccobound.co.uk/', when: '',
    lat: 51.5008, lng: -0.0811 },
  { id: 'seed-reference-point', name: 'Reference Point', area: 'Strand',
    tags: ['books', 'talk'], note: '', url: 'https://www.reference-point.uk/', when: '',
    lat: 51.5122, lng: -0.1150 },
  { id: 'seed-poetry-cafe', name: 'The Poetry Café (Stanzas)', area: 'Covent Garden',
    tags: ['poetry'], note: '', url: 'https://poetrysociety.org.uk/membership/poetry-society-stanzas/', when: '',
    lat: 51.5151, lng: -0.1236 },
  { id: 'seed-space-talk', name: 'Space Talk', area: 'Farringdon',
    tags: ['music'], note: '', url: 'https://www.spacetalklondon.com/', when: '',
    lat: 51.5196, lng: -0.1016 },
  { id: 'seed-novelty-automation', name: 'Novelty Automation', area: 'Holborn',
    tags: ['curiosities', 'making'], note: '', url: 'https://www.novelty-automation.com/', when: '',
    lat: 51.5188, lng: -0.1163 },
  { id: 'seed-conway-hall', name: 'Conway Hall', area: 'Holborn',
    tags: ['talk', 'community'], note: '', url: 'https://www.conwayhall.org.uk/whats-on/', when: '',
    lat: 51.5199, lng: -0.1185 },
  { id: 'seed-skoob', name: 'Skoob Books', area: 'Bloomsbury',
    tags: ['books'], note: '', url: 'https://skoob.com/', when: '',
    lat: 51.5244, lng: -0.1232 },
  { id: 'seed-aa-bookshop', name: 'AA Bookshop', area: 'Bloomsbury',
    tags: ['books', 'art'], note: '', url: 'https://bookshop.aaschool.ac.uk/', when: '',
    lat: 51.5192, lng: -0.1301 },
  { id: 'seed-institute-of-making', name: 'Institute of Making (UCL)', area: 'Bloomsbury',
    tags: ['making', 'science', 'workshop'], note: '', url: 'https://www.instituteofmaking.org.uk/', when: '',
    lat: 51.5241, lng: -0.1333 },
  { id: 'seed-archetype-coffee', name: 'Archetype Coffee', area: 'Fitzrovia',
    tags: ['food'], note: '', url: 'https://www.instagram.com/archetypecoffee/', when: '',
    lat: 51.5184, lng: -0.1401 },
  { id: 'seed-housmans', name: 'Housmans book groups', area: "King's Cross",
    tags: ['books', 'community'], note: '', url: 'https://housmans.com/book-groups/', when: '',
    lat: 51.5313, lng: -0.1213 },
  { id: 'seed-word-on-the-water', name: 'Word On The Water', area: "King's Cross",
    tags: ['books'], note: '', url: 'https://www.wordonthewater.co.uk/', when: '',
    lat: 51.5356, lng: -0.1247 },
  { id: 'seed-nourished-communities', name: 'Nourished Communities', area: 'Highbury',
    tags: ['food', 'community'], note: '', url: 'https://www.nourishedcommunities.com/', when: '',
    lat: 51.5602, lng: -0.1013 },
  { id: 'seed-roundhouse', name: 'Roundhouse', area: 'Camden',
    tags: ['music', 'theatre'], note: '', url: 'https://www.roundhouse.org.uk/', when: '',
    lat: 51.5434, lng: -0.1521 },

  // ---- things that happen, at a regular home (pinned at the venue) ----
  { id: 'seed-feeling-of-computing', name: 'Feeling of Computing', area: 'Bethnal Green',
    tags: ['tech', 'community'], note: '', url: 'https://feelingof.com/london/', when: '',
    lat: 51.5252, lng: -0.0714 },
  { id: 'seed-second-renaissance', name: 'Second Renaissance', area: 'Bethnal Green',
    tags: ['philosophy', 'community'], note: '', url: 'https://secondrenaissance.net/', when: '',
    lat: 51.5252, lng: -0.0714 },
  { id: 'seed-the-moth', name: 'The Moth', area: 'Shoreditch',
    tags: ['storytelling'], note: '', url: 'https://themoth.org/events/results?eventLocations=67', when: '',
    lat: 51.5242, lng: -0.0738 },
  { id: 'seed-dorkbot-london', name: 'Dorkbot London', area: 'Limehouse',
    tags: ['tech', 'art'], note: '', url: 'https://dorkbotlondon.org/', when: '',
    lat: 51.5119, lng: -0.0343 },
  { id: 'seed-london-permacomputing', name: 'London Permacomputing', area: 'Peckham',
    tags: ['tech', 'community'], note: '', url: 'https://london.permacomputing.net/', when: '',
    lat: 51.4706, lng: -0.0700 },

  // ---- things that happen, without a fixed address ----
  { id: 'seed-offline-club', name: 'The Offline Club', area: '',
    tags: ['community'], note: '', url: 'https://www.theoffline-club.com/city-chapters/london-chapter', when: '',
    lat: null, lng: null, needsCoords: true },
  { id: 'seed-philosofriends', name: 'Philosofriends', area: '',
    tags: ['philosophy', 'talk'], note: '', url: 'https://luma.com/philosofriends', when: '',
    lat: null, lng: null, needsCoords: true },
  { id: 'seed-escaping-flatland', name: 'Escaping Flatland — London meetups', area: '',
    tags: ['philosophy', 'community'], note: '', url: 'https://www.henrikkarlsson.xyz/', when: '',
    lat: null, lng: null, needsCoords: true },
  { id: 'seed-death-cafe', name: 'Death Cafe', area: '',
    tags: ['talk', 'community'], note: '', url: 'https://deathcafe.com/search/?location=London', when: '',
    lat: null, lng: null, needsCoords: true },
  { id: 'seed-independent-science-society', name: 'Independent Science Society', area: '',
    tags: ['science', 'community'], note: '', url: 'https://www.independentscience.org/', when: '',
    lat: null, lng: null, needsCoords: true },
  { id: 'seed-institute17', name: 'Institute17', area: '',
    tags: ['philosophy', 'community'], note: '', url: 'https://www.institute17.com/', when: '',
    lat: null, lng: null, needsCoords: true },
  { id: 'seed-sonderhaus', name: 'Sonderhaus', area: '',
    tags: ['community'], note: '', url: 'https://www.eventbrite.co.uk/o/sonderhaus-77930329263', when: '',
    lat: null, lng: null, needsCoords: true },
  { id: 'seed-ensemble-rodeo', name: 'Ensemble.Rodeo', area: '',
    tags: ['making', 'community', 'tech'], note: '', url: 'https://ensemble.rodeo/', when: '',
    lat: null, lng: null, needsCoords: true },
  { id: 'seed-kairos', name: 'Kairos', area: '',
    tags: ['community', 'talk'], note: '', url: 'https://www.kairos.london/', when: '',
    lat: null, lng: null, needsCoords: true },
  { id: 'seed-termite-works', name: 'Termite Works', area: '',
    tags: ['making', 'tech'], note: '', url: 'https://www.termite.works/', when: '',
    lat: null, lng: null, needsCoords: true },
  { id: 'seed-430-on-the-go', name: '430 On the Go', area: 'Canning Town',
    tags: ['community', 'art'], note: '', url: 'https://radar.squat.net/en/london/430-go', when: '',
    lat: null, lng: null, needsCoords: true },
  { id: 'seed-cranberrylemonade', name: 'cranberrylemonade', area: '',
    tags: ['community'], note: '', url: 'https://www.cranberrylemonade.xyz/', when: '',
    lat: null, lng: null, needsCoords: true },
  { id: 'seed-night-cafe', name: 'Night Cafe', area: '',
    tags: ['community'], note: '', url: '', when: '',
    lat: null, lng: null, needsCoords: true },

  // ---- living ----
  { id: 'seed-morphhouse', name: 'Morph House', area: '',
    tags: ['living', 'community'], note: '', url: 'https://morphhouse.co.uk/', when: '',
    lat: null, lng: null, needsCoords: true },
  { id: 'seed-mosaic', name: 'Mosaic', area: '',
    tags: ['living'], note: '', url: '', when: '',
    lat: null, lng: null, needsCoords: true },
  { id: 'seed-59og', name: '59OG', area: '',
    tags: ['living'], note: '', url: 'https://hallowed-cilantro-83b.notion.site/59OG-12945f38ebfb80b78cdee7edd104c788', when: '',
    lat: null, lng: null, needsCoords: true },
];

export default IN_PAGE_ORDER.slice().reverse();
