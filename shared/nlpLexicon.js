// Multilingual command vocabulary for the offline rule parser.
//
// Entries are matched across ALL languages simultaneously (people code-switch),
// after accent/punctuation folding (see normalize() in gazetteer.js), so write
// them naturally. This is the deterministic floor under the LLM: it lets common
// commands work with no API key, no network round-trip to a model, and no cost.
//
// COVERAGE NOTE: en/fr/pt/sw/ar are reasonably complete. ha/yo/ig entries are a
// best-effort starter set and need review by native speakers; the LLM path
// handles those languages fully when a provider is configured.

export const VERBS = {
  show: [
    // en
    'show', 'show me', 'display', 'turn on', 'switch on', 'enable', 'add', 'open', 'see', 'view', 'overlay', 'give me', 'let me see', 'i want to see', 'plot',
    // fr
    'montre', 'montre moi', 'montrer', 'affiche', 'afficher', 'active', 'activer', 'ajoute', 'ajouter', 'voir', 'je veux voir',
    // pt
    'mostre', 'mostra', 'mostrar', 'exibir', 'exiba', 'ative', 'ativar', 'adicionar', 'adicione', 'ver',
    // sw
    'onyesha', 'nionyeshe', 'washa', 'fungua', 'ongeza',
    // ar
    'اظهر', 'أظهر', 'اعرض', 'أعرض', 'عرض', 'شغل', 'فعل', 'اضف', 'أضف',
    // ha / yo / ig
    'nuna', 'nuna min', 'kunna', 'bude', 'fihan', 'fi han', 'han mi', 'gosi', 'gosi m', 'tinye', 'mepee',
  ],
  hide: [
    'hide', 'turn off', 'switch off', 'disable', 'remove', 'close', 'stop showing', 'hide the',
    'cache', 'cacher', 'masque', 'masquer', 'desactive', 'desactiver', 'enleve', 'enlever', 'retire', 'retirer', 'ferme',
    'oculte', 'ocultar', 'esconder', 'desativar', 'desative', 'remover', 'remova', 'fechar',
    'ficha', 'zima', 'ondoa', 'funga',
    'اخف', 'أخف', 'اخفاء', 'اغلق', 'أغلق', 'ازل', 'أزل', 'عطل',
    'boye', 'cire', 'kashe', 'pamo', 'pa a mo', 'zoo', 'wepu', 'kpochie',
  ],
  goto: [
    'go to', 'fly to', 'take me to', 'zoom to', 'zoom in on', 'zoom on', 'navigate to', 'focus on', 'center on', 'centre on', 'look at', 'where is', 'move to', 'jump to',
    'va a', 'va au', 'aller a', 'aller au', 'vole vers', 'emmene moi a', 'emmene moi au', 'zoom sur', 'centre sur', 'ou est', 'ou se trouve',
    'va para', 'ir para', 'voe para', 'leve me para', 'zoom em', 'onde fica', 'onde esta',
    'nenda', 'enda', 'nipeleke', 'kwenda', 'wapi',
    'اذهب الى', 'اذهب إلى', 'خذني الى', 'خذني إلى', 'انتقل الى', 'انتقل إلى', 'اين',
    'je zuwa', 'tafi', 'kai ni', 'lo si', 'mu mi lo si', 'gaa na', 'gaa', 'kpoga m',
  ],
  clear: [
    'clear', 'erase', 'wipe', 'delete', 'remove all',
    'efface', 'effacer', 'supprime', 'supprimer', 'nettoie',
    'limpe', 'limpar', 'apague', 'apagar',
    'futa', 'safisha',
    'امسح', 'احذف', 'نظف',
    'goge',
  ],
  annotate: [
    'mark', 'pin', 'drop a pin', 'circle', 'outline', 'highlight', 'draw', 'annotate', 'label', 'trace',
    'marque', 'marquer', 'epingle', 'entoure', 'entourer', 'surligne', 'contour', 'dessine', 'dessiner',
    'marcar', 'circule', 'contorne', 'destaque', 'desenhe', 'desenhar',
    'weka alama', 'zungushia', 'chora',
    'علم', 'حدد', 'ارسم', 'ضع علامة',
    'yi alama', 'zana', 'samisi', 'kaa akara',
  ],
};

/** Words that make a request a question for the LLM rather than a command. */
export const QUESTION_WORDS = [
  'why', 'how come', 'explain', 'because', 'meaning', 'what is', 'what are', 'what does', 'tell me about', 'cause of', 'causes', 'difference',
  'pourquoi', 'explique', 'expliquer', 'qu est ce que', 'c est quoi', 'cause',
  'por que', 'porque', 'explique', 'o que e', 'o que sao',
  'kwa nini', 'eleza', 'ni nini',
  'لماذا', 'اشرح', 'ما هو', 'ما هي',
  'saboda me', 'menene', 'bayyana', 'kilode', 'kini', 'gini bu', 'gini kpatara',
];

export const CLIMATE_QUESTION = [
  'anomaly', 'anomalies', 'compared to normal', 'compared with normal', 'than normal', 'than usual', 'than average', 'hotter than', 'warmer than', 'colder than', 'cooler than',
  'wetter than', 'drier than', 'how hot', 'how warm', 'how cold', 'how wet', 'how dry', 'climate card', 'climate summary', 'unusual', 'abnormal', 'versus normal', 'vs normal', 'compare to normal', 'weather in', 'climate in', 'climate of',
  'anomalie', 'par rapport a la normale', 'plus chaud que', 'plus froid que', 'plus sec que', 'plus humide que', 'inhabituel', 'quel temps', 'climat de', 'climat a', 'climat au', 'combien fait il chaud',
  'em relacao ao normal', 'mais quente que', 'mais frio que', 'mais seco que', 'mais chuvoso que', 'anomalia', 'clima em', 'clima de', 'clima no',
  'ikilinganishwa na kawaida', 'joto kuliko kawaida', 'mvua kuliko kawaida', 'hali ya hewa ya', 'hali ya hewa katika',
  'شذوذ', 'مقارنة بالطبيعي', 'اكثر سخونة من', 'اكثر جفافا من', 'اكثر رطوبة من', 'عن المعدل', 'الطقس في', 'المناخ في',
  'fiye da yadda ya saba', 'yanayi a',
];

export const HELP = ['help', 'what can you do', 'aide', 'ajuda', 'msaada', 'مساعدة', 'taimako', 'iranlowo', 'enyemaka', 'how do i use', 'commands'];

export const ALL_WORDS = ['all', 'everything', 'all layers', 'tout', 'toutes les couches', 'tudo', 'todas as camadas', 'zote', 'كل', 'duk', 'gbogbo', 'niile'];

/** Words naming the thing to erase when clearing annotations. */
export const ANNOTATION_NOUNS = [
  'annotation', 'annotations', 'drawing', 'drawings', 'marker', 'markers', 'pins', 'marks', 'notes', 'labels', 'circles', 'outlines',
  'annotations', 'dessins', 'marqueurs', 'epingles', 'marques',
  'anotacoes', 'desenhos', 'marcadores', 'marcas',
  'alama', 'michoro', 'علامات', 'رسومات', 'تعليقات', 'akara',
];

export const DATE_WORDS = {
  0: ['today', 'now', 'latest', 'current', 'right now', 'aujourd hui', 'maintenant', 'dernier jour', 'hoje', 'agora', 'leo', 'sasa', 'اليوم', 'الان', 'الآن', 'yau', 'yanzu', 'oni', 'taa', 'ugbu a'],
  1: ['yesterday', 'hier', 'ontem', 'jana', 'امس', 'أمس', 'jiya', 'ana', 'inyaafu'],
  7: ['last week', 'past week', 'a week ago', 'one week ago', 'la semaine derniere', 'semaine derniere', 'il y a une semaine', 'semana passada', 'ha uma semana', 'wiki iliyopita', 'wiki moja iliyopita', 'الاسبوع الماضي', 'الأسبوع الماضي', 'makon da ya gabata', 'ose to koja', 'izu gara aga'],
  30: ['last month', 'a month ago', 'one month ago', 'past month', 'mois dernier', 'le mois dernier', 'il y a un mois', 'mes passado', 'ha um mes', 'mwezi uliopita', 'الشهر الماضي', 'watan da ya gabata', 'osu to koja', 'onwa gara aga'],
};
/** Words that follow a number to mean "N days ago". */
export const DAY_UNITS = ['day', 'days', 'jour', 'jours', 'dia', 'dias', 'siku', 'يوم', 'ايام', 'أيام', 'kwanaki', 'ojo', 'ubochi'];

export const LAYER_TERMS = {
  sst: [
    'sea surface temperature', 'sea temperature', 'ocean temperature', 'water temperature', 'sst', 'ocean heat', 'sea temp',
    'temperature de la mer', 'temperature de l ocean', 'temperature de surface de la mer',
    'temperatura do mar', 'temperatura da superficie do mar', 'temperatura do oceano',
    'joto la bahari', 'halijoto ya bahari', 'joto la bahari',
    'حرارة البحر', 'درجة حرارة البحر', 'حرارة المحيط',
    'zafin teku', 'ooru okun', 'okpomoku osimiri',
    'ocean', 'sea', 'mer', 'mar', 'oceano', 'bahari', 'البحر', 'المحيط', 'teku', 'okun', 'osimiri',
  ],
  lst: [
    'land surface temperature', 'surface temperature', 'land temperature', 'temperature', 'temperatures', 'heat', 'heatwave', 'heat wave', 'hot', 'lst', 'heat map', 'how hot', 'warming',
    'temperature de surface', 'chaleur', 'canicule', 'chaud', 'temperatures',
    'temperatura', 'temperaturas', 'calor', 'onda de calor',
    'joto', 'halijoto', 'hali ya joto',
    'درجة الحرارة', 'درجات الحرارة', 'الحرارة', 'حرارة', 'حر',
    'zafi', 'zafin yanayi', 'yanayin zafi', 'ooru', 'okpomoku',
  ],
  precip: [
    'rain', 'rainfall', 'precipitation', 'rainy', 'wet', 'storm', 'storms', 'rains', 'downpour', 'monsoon',
    'pluie', 'pluies', 'precipitations', 'precipitation', 'pluviometrie',
    'chuva', 'chuvas', 'precipitacao', 'precipitacoes',
    'mvua', 'mvua nyingi',
    'المطر', 'مطر', 'امطار', 'أمطار', 'هطول',
    'ruwan sama', 'ruwan saman', 'ruwa sama', 'ojo', 'mmiri ozuzo',
  ],
  clouds: [
    'clouds', 'cloud', 'cloud cover', 'cloudy', 'overcast', 'cloudiness',
    'nuages', 'nuage', 'couverture nuageuse', 'nuageux',
    'nuvens', 'nuvem', 'nebulosidade',
    'mawingu', 'wingu',
    'غيوم', 'الغيوم', 'سحب', 'غيمة',
    'gajimare', 'gizagizai', 'awosanma', 'igwe ojii',
  ],
  ndvi: [
    'vegetation', 'greenness', 'ndvi', 'plants', 'crops', 'crop health', 'green cover', 'farmland', 'vegetation health', 'greenery', 'agriculture health',
    'verdure', 'cultures', 'couvert vegetal', 'sante des cultures',
    'vegetacao', 'cultivos', 'plantacoes', 'lavouras',
    'mimea', 'kijani', 'ukuaji wa mimea',
    'الغطاء النباتي', 'النباتات', 'نباتات', 'الزراعة', 'المحاصيل',
    'ciyayi', 'kore', 'noman', 'amfanin gona', 'eweko', 'irugbin', 'ahihia', 'ihe ubi',
  ],
  forestloss: [
    'deforestation', 'forest loss', 'tree loss', 'tree cover loss', 'logging', 'forest clearing', 'forests lost', 'forest', 'forests', 'trees lost', 'tree cover',
    'deforestation', 'perte forestiere', 'perte de couvert arbore', 'forets', 'foret', 'coupe de forets',
    'desmatamento', 'perda florestal', 'perda de floresta', 'florestas', 'floresta',
    'ukataji miti', 'ukataji wa miti', 'upotevu wa misitu', 'misitu', 'msitu',
    'ازالة الغابات', 'إزالة الغابات', 'فقدان الغابات', 'الغابات', 'غابات',
    'sare itatuwa', 'sare daji', 'asarar daji', 'daji', 'ipagborun', 'ipadanu igbo', 'ikwatu ohia', 'ohia',
  ],
  aod: [
    'aerosol', 'aerosols', 'dust', 'haze', 'smoke', 'harmattan', 'air haze', 'aod', 'particulates', 'dust storm', 'sandstorm',
    'aerosols', 'poussiere', 'brume', 'fumee', 'brume seche',
    'aerossois', 'aerossol', 'poeira', 'fumaca', 'neblina',
    'vumbi', 'moshi',
    'الهباء الجوي', 'الغبار', 'غبار', 'الدخان', 'ضباب', 'عاصفة رملية',
    'kura', 'hazo', 'hayaki', 'eruku', 'ekuru', 'uzuzu', 'anwuru',
  ],
  no2: [
    'nitrogen dioxide', 'no2', 'traffic pollution', 'urban pollution', 'combustion',
    'dioxyde d azote', 'dioxido de nitrogenio', 'ثاني اكسيد النيتروجين', 'ثاني أكسيد النيتروجين',
  ],
  co: [
    'carbon monoxide', 'monoxyde de carbone', 'monoxido de carbono', 'monoksidi ya kaboni', 'اول اكسيد الكربون', 'أول أكسيد الكربون', 'biomass burning',
  ],
  airquality: [
    'air quality', 'pollution', 'polluted air', 'pm2 5', 'pm25', 'pm 2 5', 'ground stations', 'air stations', 'aqi', 'air pollution', 'smog',
    'qualite de l air', 'pollution de l air', 'stations de mesure', 'qualite air',
    'qualidade do ar', 'poluicao', 'poluicao do ar',
    'ubora wa hewa', 'uchafuzi wa hewa', 'uchafuzi',
    'جودة الهواء', 'تلوث الهواء', 'التلوث', 'تلوث',
    'ingancin iska', 'gurbacewar iska', 'gurbataccen iska', 'gurbacewa', 'didara afefe', 'idoti afefe', 'idoti', 'ogo ikuku', 'mmeto ikuku', 'mmeto',
  ],
  emissions: [
    'emissions', 'emitters', 'greenhouse gas', 'greenhouse gases', 'ghg', 'carbon emissions', 'co2', 'factories', 'power plants', 'power plant', 'facilities', 'polluters', 'climate trace', 'flaring', 'gas flaring', 'carbon footprint', 'big emitters',
    'emissions', 'emetteurs', 'gaz a effet de serre', 'usines', 'centrales electriques', 'installations', 'emissions de carbone', 'torchage',
    'emissoes', 'emissores', 'gases de efeito estufa', 'fabricas', 'usinas', 'centrais eletricas', 'instalacoes',
    'uzalishaji wa hewa chafu', 'gesi chafu', 'viwanda', 'hewa ukaa',
    'الانبعاثات', 'انبعاثات', 'المصانع', 'محطات الطاقة', 'غازات الدفيئة',
    'masana anta', 'hayakin masana anta', 'eefin', 'ile ise', 'ulo oru',
  ],
};

export const SECTOR_TERMS = {
  power: ['power', 'electricity', 'power plant', 'power plants', 'power stations', 'centrale', 'centrales', 'electricite', 'energie', 'energia', 'usina', 'usinas', 'umeme', 'كهرباء', 'الكهرباء', 'wutar lantarki'],
  'fossil-fuel-operations': ['oil', 'gas', 'oil and gas', 'petroleum', 'flaring', 'fuel', 'crude', 'petrole', 'petroleo', 'mafuta', 'نفط', 'النفط', 'بترول', 'epo robi', 'man fetur', 'gas flaring', 'refinery', 'refineries'],
  manufacturing: ['manufacturing', 'industry', 'industrial', 'factory', 'factories', 'cement', 'steel', 'industrie', 'usines', 'industria', 'fabricas', 'viwanda', 'صناعة', 'المصانع', 'masana anta'],
  'mineral-extraction': ['mining', 'mines', 'mine', 'mineral', 'minerals', 'extraction', 'quarry', 'minerais', 'mineracao', 'uchimbaji', 'تعدين', 'التعدين', 'ma adinai'],
  waste: ['waste', 'landfill', 'garbage', 'dump', 'dechets', 'decharge', 'lixo', 'aterro', 'taka', 'takataka', 'نفايات', 'النفايات', 'shara'],
  agriculture: ['farming', 'agriculture', 'livestock', 'cattle', 'agricole', 'agricultura', 'kilimo', 'زراعة'],
  transportation: ['transport', 'transportation', 'shipping', 'aviation', 'vehicles'],
  buildings: ['buildings', 'building', 'batiments', 'edificios', 'majengo'],
};

/** Language names in every supported language → language code. */
export const LANGUAGE_NAMES = {
  en: ['english', 'anglais', 'ingles', 'kiingereza', 'الانجليزية', 'الإنجليزية', 'انجليزي', 'turanci', 'geesi', 'bekee'],
  fr: ['french', 'francais', 'frances', 'kifaransa', 'الفرنسية', 'فرنسي', 'faransanci', 'faranse'],
  ha: ['hausa', 'haoussa', 'kihausa', 'هوسا'],
  yo: ['yoruba', 'yorouba', 'kiyoruba', 'يوروبا'],
  ig: ['igbo', 'ibo', 'kiigbo', 'إيغبو'],
  sw: ['swahili', 'kiswahili', 'suahili', 'السواحيلية', 'swahili'],
  ar: ['arabic', 'arabe', 'arabe', 'kiarabu', 'العربية', 'عربي', 'larabci'],
  pt: ['portuguese', 'portugais', 'portugues', 'kireno', 'البرتغالية', 'fotigal', 'portuguese'],
};
export const LANGUAGE_WORDS = ['language', 'langue', 'idioma', 'lingua', 'lugha', 'لغة', 'harshe', 'ede', 'asusu', 'speak', 'parle', 'parler', 'fala', 'falar', 'switch to', 'change to', 'passe en', 'mude para', 'badilisha', 'تكلم'];
