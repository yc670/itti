// Fellowship level definitions, from FITTI_Executive_Deck.pdf. If the deck
// is revised, re-sync FELLOW_LEVELS so the Fellowship page keeps matching
// the authoritative language.

export const FELLOW_LEVELS = [
  {
    code: 'AFITTI',
    name: 'Associate Fellow',
    tag: 'Emerging Leaders',
    description: 'Designated for students, early-career professionals, humanitarian workers, educators, journalists, and activists.'
  },
  {
    code: 'FITTI',
    name: 'Professional Fellow',
    tag: 'Flagship — Senior Professionals',
    description: 'Flagship professional fellowship for senior practitioners, policymakers, researchers, and institutional leaders.'
  },
  {
    code: 'SFITTI',
    name: 'Senior Fellow',
    tag: 'Invitation Only',
    description: 'Invitation-only senior fellowship for diplomats, ministers, professors, commissioners, and global experts.'
  },
  {
    code: 'DFITTI',
    name: 'Distinguished Fellow',
    tag: 'Honorary',
    description: 'Honorary distinction recognizing internationally influential peacebuilders, trauma scholars, and humanitarian leaders.'
  }
];

export const WHO_SHOULD_APPLY = [
  'Government officials', 'Ministers of Health', 'Ministers of Justice', 'Diplomats', 'UN and WHO officials',
  'Security experts and heads of police or military institutions', 'University presidents and faculty',
  'Foundation and nonprofit leaders', 'Judges and commissioners', 'Peacebuilding leaders',
  'Humanitarian executives', 'Senior clinicians', 'Military medical leaders',
  'Community leaders and institutional heads', 'Individuals with a proven interest in collective trauma programs'
];

export const EXECUTIVE_VALUE = [
  'Access to a high-level international network of leaders and institutions.',
  'Thought leadership through publications, policy dialogue, and strategic missions.',
  'Opportunity to shape trauma-informed governance, observatories, and national recovery frameworks.',
  'Recognition through the FITTI™ designation and lifelong affiliation with ITTI.'
];

export const FELLOWS_GAIN = [
  'International Recognition',
  'Strategic Global Network',
  'Thought Leadership Platform',
  'Institutional Influence',
  'Lifelong FITTI™ Designation'
];

// Each entry follows this shape:
//   {
//     id: 'unique-slug',
//     name: 'Full Name',
//     level: 'AFITTI' | 'FITTI' | 'SFITTI' | 'DFITTI',   // must match a FELLOW_LEVELS code
//     bio: 'Short biography.',
//     photo: '/images/fellows/<slug>.jpg'                         // optional; falls back to initials
//   }
export const FELLOWS = [
  {
    id: 'blessing-ojisor',
    name: 'Blessing Alims Ojisor',
    level: 'AFITTI',
    photo: '/images/fellows/blessing-ojisor.jpg',
    bio: [
      "Blessing Alims Ojisor is an Associate Fellow with the International Truth & Trauma Institute, bringing a background in Peace Studies and Conflict Resolution to trauma informed governance and institutional reform. She made history and emerged as a First-Class-Honors best-graduating student and the first female president of the Student Union Government at the University of Calabar, Nigeria in the institution's 49th year, a portfolio that demonstrates her commitment to challenging entrenched systems.",
      "Through years of community development work, most notably as founder of the Bagori Care Foundation, along with structural governance experience, she now advances ITTI's mission by turning research into strategic interventions for national healing, civic stabilization, and gender inclusive policy."
    ]
  },
  {
    id: 'hannah-toth',
    name: 'Hannah Toth',
    level: 'AFITTI',
    photo: '/images/fellows/hannah-toth.jpg',
    bio: [
      "Hannah Toth is an Associate Fellow with the International Truth & Trauma Institute, working within the Collective Psych Trauma Observatory under Dr. Luke Chike Igweobi. Her work focuses on building quantitative frameworks for measuring collective trauma and election-related violence, including contributions to the Global Trauma Burden Index and Election Trauma Temperature Index.",
      "As a clinical psychology student and Division I collegiate runner, she brings the same discipline she applies to training to her research: grounded in evidence, methodical, and committed to clear, accurate data. Her interests span clinical psychology, PTSD, trauma, and public health disparities, and she is currently working on manuscripts that position collective trauma frameworks within clinical psychology as she prepares to pursue a PhD in the field."
    ]
  },
  {
    id: 'stanley-yang',
    name: 'Stanley Yang',
    level: 'AFITTI',
    photo: '/images/fellows/stanley-yang.jpg',
    bio: [
      "Stanley Yang is an Associate Fellow with the International Truth & Trauma Institute and a graduate of the University of Illinois Urbana-Champaign (UIUC). He has supported the Institute's research infrastructure by assisting in data collection for the Election Trauma Temperature Index (ETTI) Observatory, contributing to the quantitative foundation behind ITTI's trauma measurement frameworks.",
      "Beyond his research contributions, Stanley built ITTI's website, bringing technical expertise to the Institute's public-facing platform and helping ensure its research, observatories, and programs are accessible to a global audience.",
      "Driven and ambitious, Stanley is always looking ahead, eager to take on new opportunities and challenges that push him to grow and to expand the impact he can bring to ITTI's mission."
    ]
  }
];

// Institute leadership — Chancellor, Directors, and Board — shown in their
// own section above the Fellows roster since these roles sit outside the
// AFITTI/FITTI/SFITTI/DFITTI fellowship levels.
// bio is an array of blocks:
//   { type: 'p', text }              paragraph
//   { type: 'h4', text }             subheading
//   { type: 'quote', text }          pull quote
//   { type: 'book', title, text }    book title + description
export const LEADERSHIP = [
  {
    id: 'luke-igweobi',
    name: 'Dr. Luke Chike Igweobi, DNP, MS, PMHNP-BC',
    title: 'Chancellor, International Truth & Trauma Institute (ITTI)',
    photo: '/images/fellows/luke-igweobi.jpg',
    bio: [
      { type: 'p', text: 'Some clinicians treat trauma. Some scholars study war, conflict, or political violence. Few have attempted to build a unified scientific framework connecting psychiatry with the long-term psychological behavior of nations.' },
      { type: 'p', text: 'Dr. Luke Chike Igweobi is a board-certified psychiatric mental health clinician, collective trauma scholar, educator, author, Chancellor, and Professor of Population Resilience, Behavioral Health and Human Development at the International Truth & Trauma Institute (ITTI). His work stands at the intersection of psychiatry, neuroscience, public health, international relations, peacebuilding, and post-conflict governance.' },
      { type: 'p', text: 'Over the past decade, Dr. Igweobi has pursued a question largely unexplored within modern psychiatric science:' },
      { type: 'quote', text: 'What happens when trauma is no longer viewed solely as an individual disorder, but as a population-wide phenomenon capable of reshaping entire nations?' },
      { type: 'p', text: 'This question became the foundation of his pioneering work in National Psychiatry—an emerging interdisciplinary field that applies psychiatric principles to understanding collective trauma, institutional dysfunction, democratic instability, intergenerational transmission of violence, and national healing.' },
      { type: 'p', text: 'To address the limitations of existing diagnostic systems, Dr. Igweobi originated the National Population-Wide Post-Traumatic Stress Disorder (NPW-PTSD) Framework, the first clinical architecture designed to assess trauma at the level of populations rather than individuals. He subsequently developed the International Trauma Classification System (ITCS), the Global Trauma Burden Index (GTBI), and the Election Trauma Temperature Index (ETTI)—innovative instruments that enable governments, researchers, and international organizations to measure collective trauma, democratic dysregulation, institutional vulnerability, and societal recovery.' },
      { type: 'p', text: 'As Chancellor of ITTI, Dr. Igweobi leads an international community of clinicians, researchers, diplomats, policymakers, educators, and peacebuilders committed to advancing trauma-informed governance and post-conflict recovery. Through ITTI, he established the International Trauma Observatory, a global research initiative dedicated to measuring collective trauma across nations and translating scientific evidence into practical tools for reconciliation, institutional reform, and sustainable peace.' },
      { type: 'p', text: 'Alongside his research, Dr. Igweobi serves as Executive and Clinical Director of Outlets for Hope, Inc., and Clinical Director of Tailored Behavioral Health, where he provides trauma-informed psychiatric care to veterans, refugees, immigrants, and individuals living with complex trauma and addiction. His clinical practice continually informs his scholarly work, ensuring that every theory remains grounded in the lived experiences of patients and communities.' },
      { type: 'p', text: 'Dr. Igweobi earned his Doctor of Nursing Practice from New Mexico State University and completed graduate studies in Environmental Policy and International Development at Harvard University, bringing together clinical psychiatry, systems leadership, public policy, and international development into a unified framework for understanding societal healing.' },
      { type: 'h4', text: 'Books' },
      { type: 'p', text: "Rather than treating each publication as a standalone work, Dr. Igweobi's books collectively examine the many faces of collective trauma—from war and colonialism to migration, identity, poverty, governance, tourism, and global power." },
      { type: 'book', title: 'What Trauma Does to Nations: And What It Takes to Begin Healing (2026)', text: "Dr. Igweobi's landmark work introducing the NPW-PTSD Framework and the scientific foundations of National Psychiatry. The book argues that wars, colonization, political violence, terrorism, systemic injustice, and institutional betrayal produce enduring psychological injuries that influence governance, democracy, economic development, and national identity long after violence has ended. It presents a comprehensive roadmap for national healing through truth-telling, trauma-informed institutions, and constitutional reform." },
      { type: 'book', title: 'Healing from the Unfinished War: The Untreated War Trauma Holding Nigeria Hostage—and How to Heal It (2025)', text: "Applying the NPW-PTSD Framework to Nigeria, this book examines the unresolved psychological legacy of the Nigerian Civil War and argues that the country's ethnic polarization, political instability, institutional mistrust, and recurring national crises cannot be fully understood without confronting the nation's untreated collective trauma. It proposes a practical blueprint for national reconciliation grounded in truth, remembrance, institutional reform, and psychological healing." },
      { type: 'book', title: "Powerful & Paranoid: The Psychiatric Autopsy of America's Diplomacy and Global Leadership (2025)", text: 'In one of his most ambitious geopolitical works, Dr. Igweobi applies trauma neuroscience and clinical psychiatry to nearly eight decades of American foreign policy, examining the United States as a nation whose extraordinary global power coexists with persistent hypervigilance, threat perception, and strategic anxiety. Rather than assigning blame, the book explores how national trauma, attachment injury, moral injury, and the neuroscience of fear may shape diplomacy, military intervention, alliances, and cycles of global engagement and withdrawal. As the cover states, it is "not a book of blame—it is a clinical inquiry and a roadmap for healing."' },
      { type: 'book', title: 'Divided & Conquered: A Blueprint for National Healing After Collective Manipulation (2025)', text: 'Drawing on historical analysis and psychiatric theory, this work explores how divide-and-rule strategies employed during the colonial era continue to shape political identity, ethnic mistrust, democratic instability, and institutional dysfunction across former British Commonwealth nations. Through case studies including Nigeria, Kenya, India, Pakistan, Myanmar, Guyana, Jamaica, Ireland, Zimbabwe, and South Africa, the book argues that colonial manipulation left enduring psychological infrastructures of fear that still influence modern governance and social cohesion. It concludes with a practical blueprint for national healing.' },
      { type: 'book', title: 'Ten Years in Tripoli (2025)', text: 'Set against the backdrop of post-war Libya, this novel explores the collective trauma experienced by migrants trapped within civil war, human trafficking, displacement, and statelessness. Through fiction grounded in lived realities, it reveals how prolonged conflict transforms both individuals and societies, exposing the hidden psychological costs of migration and humanitarian collapse.' },
      { type: 'book', title: 'Monday in Marrakech (2025)', text: "A literary exploration of ethical travel, Monday in Marrakech challenges readers to move beyond sightseeing toward witnessing. Set in one of the world's most celebrated tourist destinations, the novel asks whether travelers truly encounter the people and histories of the places they visit or merely consume curated experiences while overlooking the communities that sustain them. Through stories of local families, artisans, workers, and forgotten neighborhoods, the book examines the collective trauma of destinations shaped by colonial legacies, unequal tourism economies, cultural commodification, and historical neglect. It argues that responsible travel begins not with photographs, but with empathy, dignity, remembrance, and genuine human connection." },
      { type: 'book', title: 'Suya Economics: The Story of the Half-Dead Cow (2025)', text: 'Blending satire, political allegory, and social commentary, Suya Economics uses the image of a "half-dead cow" to examine the political economy of survival in resource-rich but deeply unequal societies. Through memorable characters gathered around a roadside suya stand, the book explores corruption, patronage, inequality, debt, foreign dependence, environmental degradation, and the informal economy. Beneath its humor lies a deeper diagnosis: the collective trauma of populations living in chronic scarcity amid extraordinary national wealth, where resilience often masks exhaustion and survival becomes a permanent psychological condition.' },
      { type: 'book', title: 'Babel Republic (2025)', text: 'A political novel exploring the psychological consequences of ethnic fragmentation, identity politics, institutional corruption, and competing historical narratives. The story illustrates how unresolved collective trauma fractures national identity, perpetuates mistrust, and transforms diversity into chronic political conflict, while imagining the possibility of reconciliation through shared memory and civic renewal.' },
      { type: 'book', title: 'My Son Tiffany (2025)', text: 'Set between post-war Nigeria and New York City, this deeply human novel explores family, identity, stigma, and unconditional love. Through the story of a gifted child navigating questions of gender identity and belonging, the novel examines the collective trauma created when societies marginalize those who challenge cultural expectations. It reflects on how prejudice, inherited norms, and social exclusion wound not only individuals but also families, communities, and generations.' },
      { type: 'h4', text: 'A Unified Body of Work' },
      { type: 'p', text: "Across scholarly publications and literary fiction, Dr. Igweobi's work advances a single unifying proposition:" },
      { type: 'quote', text: 'Collective trauma is not confined to battlefields. It is found wherever entire populations inherit fear, silence, exclusion, injustice, displacement, manipulation, or historical wounds that remain untreated.' },
      { type: 'p', text: 'Whether examining civil wars, migration, tourism, colonialism, geopolitical power, economic inequality, or family identity, his books seek to illuminate the hidden psychological forces shaping human societies—and to offer practical pathways toward truth, healing, reconciliation, and lasting peace.' },
      { type: 'h4', text: 'Vision' },
      { type: 'p', text: "Through his scholarship, clinical practice, institutional leadership, and writing, Dr. Igweobi seeks to establish collective trauma as a recognized field of global scientific inquiry and public policy. His vision is a world in which governments, international organizations, clinicians, educators, and communities possess the tools to diagnose societal wounds with the same rigor applied to diagnosing illness in individuals—and to build institutions capable of healing them." },
      { type: 'p', text: 'Under his leadership, the International Truth & Trauma Institute continues to advance research, professional education, policy innovation, and international collaboration toward a single enduring mission:' },
      { type: 'quote', text: 'Helping wounded nations remember truthfully, heal collectively, and build institutions that no longer transmit trauma—but cultivate peace, resilience, justice, and hope.' },
      { type: 'quote', text: '"Healing individuals transforms lives. Healing collective trauma transforms nations." — Dr. Luke Chike Igweobi' }
    ]
  },
  {
    id: 'stephanie-saintil',
    name: 'Stephanie Saintil, RN, BSN',
    title: 'Chairperson, Board of Directors, International Truth & Trauma Institute (ITTI)',
    photo: '/images/fellows/stephanie-saintil.jpg',
    bio: [
      { type: 'p', text: 'Stephanie Saintil, RN, BSN, is an accomplished healthcare leader, registered nurse, and advocate for health equity whose career has been dedicated to strengthening healthcare quality, advancing inclusive leadership, and improving patient outcomes through systems-level innovation. As Chairperson of the Board of Directors of the International Truth & Trauma Institute (ITTI), she provides strategic governance and institutional oversight, helping guide the Institute\'s mission to advance research, education, policy, and international collaboration in collective trauma, truth-telling, and trauma-informed governance.' },
      { type: 'p', text: 'Throughout her professional career, Ms. Saintil has demonstrated a strong commitment to excellence in clinical practice, healthcare operations, regulatory compliance, and quality improvement. At Lemuel Shattuck Hospital, she has played an important leadership role in strengthening procedural standards, improving regulatory compliance, enhancing surgical safety initiatives, and fostering interdisciplinary collaboration across clinical teams. Her work reflects a deep understanding of patient-centered care, organizational accountability, and the importance of evidence-based systems capable of delivering safe, equitable, and high-quality healthcare.' },
      { type: 'p', text: "Prior to her leadership at Lemuel Shattuck Hospital, Ms. Saintil gained extensive clinical experience within several of Boston's leading academic medical centers, including Brigham and Women's Hospital and Boston Medical Center. These experiences exposed her to diverse patient populations and complex healthcare environments, shaping a comprehensive perspective on healthcare delivery that integrates clinical excellence with compassion, cultural humility, and systems thinking." },
      { type: 'p', text: 'A recognized advocate for diversity, equity, and inclusion within healthcare, Ms. Saintil has consistently championed initiatives that promote equitable access to care, strengthen opportunities for underrepresented healthcare professionals, and cultivate inclusive workplace cultures. She believes that sustainable improvements in healthcare require institutions that not only deliver excellent clinical care but also reflect the diversity, dignity, and lived experiences of the communities they serve.' },
      { type: 'p', text: "Ms. Saintil's commitment to trauma-informed care extends beyond the United States. Following the devastating 2010 Haiti earthquake, she participated in humanitarian efforts serving earthquake-affected communities in Port-au-Prince, providing healthcare support to populations living with the profound physical, psychological, and social consequences of one of the Western Hemisphere's deadliest natural disasters. Working alongside local communities, she witnessed firsthand the enduring effects of mass displacement, loss, disrupted healthcare systems, and collective trauma. This experience strengthened her commitment to building resilient, trauma-informed systems of care and continues to shape her perspective on humanitarian response, disaster recovery, and community healing." },
      { type: 'p', text: 'Beyond her clinical and humanitarian leadership, Ms. Saintil is actively engaged in broader conversations surrounding public health, health policy, mental health access, and community development. Her interests include reducing healthcare disparities affecting historically underserved and inner-city populations, advancing trauma-informed systems of care, and promoting policies that improve both individual and population health outcomes. She is particularly passionate about developing healthcare systems that recognize the social, cultural, and structural determinants influencing health and well-being.' },
      { type: 'p', text: "As Chairperson of the ITTI Board of Directors, Ms. Saintil works closely with the Institute's leadership to strengthen organizational governance, promote strategic growth, expand international partnerships, and uphold the highest standards of integrity, accountability, and scientific excellence. Her leadership supports ITTI's commitment to advancing innovative research on collective trauma while fostering collaboration among clinicians, researchers, policymakers, educators, and peacebuilding practitioners working to promote healing, reconciliation, and resilient societies worldwide." },
      { type: 'p', text: 'An enthusiastic mentor and lifelong advocate for professional development, Ms. Saintil remains committed to inspiring the next generation of nurses and healthcare leaders. Through her leadership, she continues to advance a vision of healthcare that is compassionate, equitable, evidence-driven, and responsive to the needs of diverse communities—strengthening institutions while improving the lives of those they serve.' },
      { type: 'p', text: 'Her service on the Board reflects her enduring belief that ethical leadership, inclusive governance, and trauma-informed institutions are essential to building healthier communities, restoring hope after adversity, and advancing meaningful social change on a global scale.' }
    ]
  },
  {
    id: 'saeed-siddique',
    name: 'Dr. Saeed A. Siddique, DNP, FNP-BC',
    title: 'Director, International Truth & Trauma Institute (ITTI)',
    photo: '/images/fellows/saeed-siddique.jpg',
    bio: [
      { type: 'p', text: "Dr. Saeed A. Siddique, DNP, FNP-BC, is an accomplished Family Nurse Practitioner, clinician, humanitarian, and educator whose career has been dedicated to improving health outcomes among military veterans, migrant populations, and underserved communities. As a Director of the International Truth & Trauma Institute (ITTI), he brings extensive frontline experience in veteran healthcare, trauma-informed clinical practice, humanitarian service, and population health, supporting the Institute's mission to advance research, education, and policy on collective trauma, post-conflict recovery, migration, and human resilience." },
      { type: 'p', text: "Throughout his professional career, Dr. Siddique has served within Harvard-Medical-affiliated hospitals and within the VA Boston Healthcare System, where he has provided comprehensive primary and behavioral healthcare to United States military veterans living with the long-term consequences of military service. His clinical practice has included caring for veterans affected by Post-Traumatic Stress Disorder (PTSD), depression, anxiety, traumatic brain injury, chronic medical conditions, and the complex physical and psychological effects of combat exposure. Working within one of the nation's leading veterans' healthcare systems, he has collaborated with interdisciplinary teams to deliver holistic, patient-centered care that recognizes the close relationship between physical health, psychological well-being, and long-term recovery." },
      { type: 'p', text: 'Beyond his work with veterans, Dr. Siddique has devoted significant effort to improving healthcare access for vulnerable and displaced populations across multiple international settings. In New York City, he has worked extensively with migrant communities, helping address the complex healthcare needs of newly arrived individuals and families navigating displacement, resettlement, cultural transition, and barriers to healthcare access. His work has emphasized compassionate, culturally responsive care for populations often affected by migration-related trauma, socioeconomic hardship, and limited access to preventive health services.' },
      { type: 'p', text: 'His humanitarian commitment also extends to Northern Ghana, where he has worked with returning and stranded West African migrants, many of whom had experienced failed migration journeys, displacement, exploitation, family separation, and significant psychosocial distress. Supporting migrant populations during reintegration has given him firsthand insight into the lasting effects of forced migration, economic insecurity, and collective trauma on individuals, families, and communities, reinforcing his commitment to trauma-informed and culturally grounded models of care.' },
      { type: 'p', text: 'Dr. Siddique earned his Doctor of Nursing Practice (DNP) from the College of Health, Education and Social Transformation at New Mexico State University, where his doctoral education emphasized evidence-based practice, population health, healthcare quality improvement, systems leadership, and the translation of research into clinical practice. His advanced training has prepared him to lead quality improvement initiatives while promoting patient-centered models of care that improve health outcomes across diverse populations.' },
      { type: 'p', text: "As a member of the Board of Directors of the International Truth & Trauma Institute, Dr. Siddique contributes valuable clinical expertise to the Institute's work examining the intersection of individual trauma and collective trauma. His experience caring for military veterans, migrant populations, and displaced communities provides a unique perspective on how armed conflict, forced migration, displacement, and historical adversity shape health across generations. His leadership helps ensure that ITTI's research remains firmly grounded in frontline clinical realities while informing innovative approaches to healing individuals, communities, and societies affected by war, migration, violence, and humanitarian crises." },
      { type: 'p', text: 'Dr. Siddique is committed to advancing interdisciplinary collaboration, strengthening trauma-informed healthcare systems, and mentoring future healthcare professionals dedicated to compassionate, evidence-based practice. Through his clinical leadership, humanitarian service, and work with ITTI, he continues to promote a vision in which healthcare, research, and public policy work together to foster healing, resilience, dignity, and lasting peace for populations affected by trauma around the world.' }
    ]
  }
];