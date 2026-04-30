/**
 * nameGenerator.js — PF1e / Golarion Random Name Generator
 *
 * Shared utility for generating character and NPC names with gender support.
 * Supports: 7 races, 10 Golarion human ethnicities, 1500+ titles/nicknames,
 * 250+ standalone monikers, and multiple name format styles.
 *
 * Usage:
 *   import { generateRandomName, generateNPCName, ETHNICITIES } from '../utils/nameGenerator';
 *   generateRandomName('Dwarf');                    // "Dolgrin Ironforge"
 *   generateRandomName('Human', 'Ulfen', 'Female'); // "Astrid Frostheim, the Wolf"
 *   generateRandomName('Elf', null, 'Male');        // "Caladrel Amakiir"
 *   generateNPCName({ race: 'Half-Orc', gender: 'Female', role: 'merchant' }); // "Ashka the Trader"
 */

// ═══════════════════════════════════════════════════
//  GOLARION HUMAN ETHNICITIES
// ═══════════════════════════════════════════════════

export const ETHNICITIES = [
  'Chelaxian','Varisian','Shoanti','Ulfen','Tian','Keleshite',
  'Garundi','Mwangi','Vudrani','Taldan',
];

const ETHNIC_NAMES = {
  // Chelaxian — Italian/Spanish flavored, Cheliax diabolist empire
  Chelaxian: {
    first: [
      'Aberian','Aluceda','Amaya','Antonia','Arael','Barzillai','Callistria','Cerelia',
      'Cimri','Coriana','Dario','Ecarrdian','Eliasia','Fiorela','Gaspar','Glorio',
      'Ileosa','Jacinda','Kastner','Lazzero','Lictor','Lucretia','Marcello','Meratt',
      'Neferpitra','Octavia','Paracount','Quintessa','Reedan','Rosala','Sargaeta','Tessara',
      'Tybain','Umberto','Vahnwynne','Vourne','Xenobia','Zarta','Aldini','Belleza',
      'Calseinica','Delvehane','Eirtein','Falcario','Grulios','Hedvend','Iovinus','Jilia',
      'Kastoria','Loredana','Malthus','Nolveniss','Ornelos','Pavo','Quixano','Remesiana',
      'Sirtane','Thrune','Ulivestra','Vashnarstill',
    ],
    male: [
      'Aberian','Barzillai','Dario','Ecarrdian','Falcario','Gaspar','Glorio','Hedvend',
      'Iovinus','Kastner','Lazzero','Lictor','Marcello','Meratt','Ornelos','Pavo',
      'Reedan','Tybain','Umberto','Vourne','Aldini','Eirtein','Grulios','Malthus',
      'Nolveniss','Quixano','Sirtane','Vashnarstill','Arvanxi','Basileus','Findarato',
    ],
    female: [
      'Aluceda','Amaya','Antonia','Arael','Callistria','Cerelia','Cimri','Coriana',
      'Eliasia','Fiorela','Ileosa','Jacinda','Lucretia','Neferpitra','Octavia','Quintessa',
      'Rosala','Sargaeta','Tessara','Vahnwynne','Xenobia','Zarta','Belleza','Calseinica',
      'Delvehane','Jilia','Kastoria','Loredana','Remesiana','Ulivestra','Liranne','Eiseth',
    ],
    last: [
      'Thrune','Henderthane','Sarini','Grulios','Jhaltero','Dioso','Aulamaxa','Kintargo',
      'Tanessen','Narikopolus','Arvanxi','Charthagnion','Drovenge','Eiodacio','Faraven',
      'Ghival','Henderthane','Jeggare','Kastner','Leroung','Mezinas','Nightswarm',
      'Oberigo','Phandros','Rosala','Salisfer','Tilernos','Vashnarstill','Xerysis','Zincher',
      'Archmann','Basileus','Cruxari','Dellamortae','Eiseth','Findarato','Gavarro',
      'Hellknight','Imperious','Julistarc','Khollarix','Liranne','Molthune','Nidal',
    ],
  },

  // Varisian — Romani/Eastern European, wanderers and fortune-tellers
  Varisian: {
    first: [
      'Ameiko','Alika','Brindolyn','Calista','Desna','Esmeralda','Fera','Giada',
      'Hayla','Ionela','Jeva','Kalinda','Leilani','Merisiel','Natalya','Oprea',
      'Pirelle','Quara','Risa','Sabriyya','Tessara','Ursa','Valeska','Wyanet',
      'Ximena','Yolantha','Zella','Aisha','Bimala','Camlo',
      'Daj','Emilian','Florica','Gavril','Hanzi','Ilona','Jal','Kizzy',
      'Luca','Mirela','Nadya','Orlenda','Petsha','Radu','Simza','Todor',
      'Vadoma','Zurka','Alezni','Bexley','Calanthe','Drina','Etienne','Fane',
      'Gildasio','Hanelore','Iovita','Jeta',
    ],
    male: [
      'Camlo','Daj','Emilian','Gavril','Hanzi','Jal','Luca','Radu','Todor','Alezni',
      'Etienne','Fane','Gildasio','Bexley','Calanthe','Drina','Petsha','Simza',
      'Andor','Bestian','Cristobal','Dimitri','Ezekiel','Foresti','Grigor','Hendrick',
    ],
    female: [
      'Ameiko','Alika','Brindolyn','Calista','Desna','Esmeralda','Fera','Giada',
      'Hayla','Ionela','Jeva','Kalinda','Leilani','Merisiel','Natalya','Oprea',
      'Pirelle','Quara','Risa','Sabriyya','Tessara','Ursa','Valeska','Wyanet',
      'Ximena','Yolantha','Zella','Aisha','Bimala','Florica','Mirela','Nadya',
      'Orlenda','Vadoma','Zurka','Hanelore','Iovita','Jeta','Mariska','Svetlana',
    ],
    last: [
      'Kaijitsu','Mvashti','Valdemar','Teskertin','Sczarni','Szarni','Balacazar',
      'Crosspatch','Duskryn','Fortunado','Gildersleeve','Harrowstone','Indros',
      'Jasperleaf','Kezmarek','Loresong','Moonweaver','Nightmist','Opaline',
      'Porphyria','Quicksilver','Ravenholm','Starsong','Thistledown','Umbravale',
      'Virlych','Wanderlight','Zalamandra','Avenstar','Brightwater',
      'Carnivale','Dusksinger','Emberwind','Firefly','Ghostdancer',
      'Havencall','Inkfingers','Jadeshimmer','Kismet','Lotusbloom',
    ],
  },

  // Shoanti — tribal warriors, Native American-inspired naming
  Shoanti: {
    first: [
      'Gaekhen','Krojun','Nalmid','Shadde-Quah','Tekritanin','Akram','Ashwind',
      'Blackfeather','Cinderhawk','Duskwalker','Eagleclaw','Firemane','Grayhawk',
      'Hawkeye','Ironwolf','Jadewind','Keeneye','Longstride','Moonshadow',
      'Nightrunner','Owlfeather','Proudstep','Quickarrow','Redthorn','Skyreach',
      'Stonebear','Thundercloud','Ursine','Voidwalker','Windcaller',
      'Ashpeak','Bonecrow','Cragfist','Darkstorm','Elkhorn','Flamestrike',
      'Goregrip','Hailstrike','Icevein','Jawbone','Kingfisher','Lightfoot',
      'Mammoth','Nighteagle','Oakarm','Pineblood','Quailheart','Riverfang',
      'Sunhammer','Totemguard','Umber','Vultureeye','Wolfpelt','Yewbow',
      'Zenithhawk','Ashblood','Bravecall','Cliffrunner','Dustdevil','Earthsong',
    ],
    male: [
      'Gaekhen','Krojun','Nalmid','Tekritanin','Akram','Ashwind','Blackfeather','Cinderhawk',
      'Duskwalker','Eagleclaw','Firemane','Grayhawk','Hawkeye','Ironwolf','Jadewind','Keeneye',
      'Longstride','Moonshadow','Nightrunner','Proudstep','Quickarrow','Redthorn','Skyreach',
      'Stonebear','Thundercloud','Voidwalker','Windcaller','Ashpeak','Bonecrow','Cragfist',
    ],
    female: [
      'Shadde-Quah','Darkstorm','Elkhorn','Flamestrike','Goregrip','Hailstrike','Icevein',
      'Kingfisher','Lightfoot','Mammoth','Nighteagle','Oakarm','Pineblood','Quailheart',
      'Riverfang','Sunhammer','Totemguard','Umber','Vultureeye','Wolfpelt','Yewbow','Zenithhawk',
      'Ashblood','Bravecall','Cliffrunner','Dustdevil','Earthsong','Owlfeather','Windrunner',
      'Cloudwhisper','Starseeker','Raincaller',
    ],
    last: [
      'Skoan-Quah','Sklar-Quah','Shriikirri-Quah','Lyrune-Quah','Shadde-Quah',
      'Tamiir-Quah','Shundar-Quah','Firewalker','Thundercaller','Earthshaker',
      'Skywatcher','Windstrider','Stormbringer','Rockbreaker','Ironblood',
      'Moonstalker','Sunspeaker','Stargazer','Spiritwalker','Bonedancer',
      'Ashwalker','Dustrunner','Cliffhanger','Ravencaller','Wolfbrother',
      'Beartooth','Eaglebane','Hawkscream','Serpentfang','Bisonherd',
      'Coyotecry','Falconswift','Lynxeye','Elkstride','Crowfeast',
      'Vulturepeak','Scorpiontail','Thunderhoof','Firebreath','Icehowl',
    ],
  },

  // Ulfen — Norse/Viking, Land of the Linnorm Kings
  Ulfen: {
    first: [
      'Bjorn','Sigrid','Ragnar','Astrid','Thorin','Freya','Gunnar','Helga',
      'Ingvar','Jorunn','Knut','Lagertha','Magnus','Njord','Olaf','Petra',
      'Ragnhild','Sven','Thyra','Ulfgar','Vigdis','Wulfric','Ylva','Agnar',
      'Brynhild','Dagfinn','Eirik','Freja','Greta','Halvard',
      'Ivar','Jormund','Kari','Leif','Marta','Nils','Oskar','Pernilla',
      'Roald','Solveig','Torsten','Ulf','Vidar','Yrsa','Arne','Borghild',
      'Canute','Dagny','Edda','Folkvar','Gunnhild','Haldor','Inga','Jarl',
      'Ketil','Liv','Magne','Nanna','Odin','Runa',
    ],
    male: [
      'Bjorn','Ragnar','Thorin','Gunnar','Ingvar','Knut','Magnus','Njord','Olaf','Sven',
      'Ulfgar','Wulfric','Agnar','Dagfinn','Eirik','Halvard','Ivar','Jormund','Leif','Nils',
      'Oskar','Roald','Torsten','Ulf','Vidar','Arne','Canute','Folkvar','Haldor','Jarl',
      'Ketil','Magne','Odin','Ragnarr','Soren','Hendrik',
    ],
    female: [
      'Sigrid','Astrid','Freya','Helga','Jorunn','Lagertha','Petra','Ragnhild','Thyra',
      'Vigdis','Ylva','Brynhild','Freja','Greta','Kari','Marta','Pernilla','Solveig','Yrsa',
      'Borghild','Dagny','Edda','Gunnhild','Inga','Liv','Nanna','Runa','Astri','Bjorgulfur',
      'Gudrun','Ingrid','Signy','Ulla','Vilde',
    ],
    last: [
      'Frostheim','Ironside','Stormborn','Blackmane','Bloodaxe','Dragonslayer',
      'Elkhorn','Fjordwalker','Grimmjaw','Hailstone','Icebreaker','Jotunfist',
      'Kraken','Longship','Mjolnir','Northwind','Oathsworn','Plunderer',
      'Ravenfeeder','Shieldwall','Thunderborn','Vikingr','Wulfheart',
      'Ashenholm','Bearcloak','Coldforge','Deepsea','Evernight','Frostbeard',
      'Graywolf','Hallbjorn','Icevein','Jokulheim','Kaldheim','Lindworm',
      'Mistfjord','Nidhogg','Ormrheim','Permafrost','Ragnaheim','Skaldsson',
      'Trollbane','Ulfhednar','Valkyrjar','Winterborn',
    ],
  },

  // Tian — East Asian (Chinese, Japanese, Korean, Vietnamese mix), Tian Xia
  Tian: {
    first: [
      'Ameiko','Amatatsu','Bai','Chen','Daiyu','Eiko','Fumiko','Genji',
      'Hatsue','Ichiro','Jiao','Kaede','Lin','Mei','Noboru','Oki',
      'Ping','Qiao','Ren','Sakura','Takeshi','Umeko','Wen','Xian',
      'Yuki','Zhao','Akemi','Bao','Chang','Daisuke',
      'Emiko','Fang','Goro','Hana','Isamu','Jun','Keiko','Lei',
      'Makoto','Nori','Osamu','Pei','Qin','Riku','Suki','Taro',
      'Ushi','Wei','Xue','Yori','Zhen','Akira','Chun','Daichi',
      'Etsuko','Feng','Guang','Haruki','Izumi','Jiro',
    ],
    male: [
      'Amatatsu','Chen','Genji','Ichiro','Noboru','Oki','Takeshi','Zhao','Bao','Chang',
      'Daisuke','Fang','Goro','Isamu','Jun','Makoto','Osamu','Qin','Riku','Taro',
      'Wei','Yori','Zhen','Akira','Chun','Daichi','Feng','Guang','Haruki','Jiro',
      'Katsu','Masaru','Nobunaga','Raiden','Takeshi',
    ],
    female: [
      'Ameiko','Daiyu','Eiko','Fumiko','Hatsue','Jiao','Kaede','Lin','Mei','Ping',
      'Qiao','Ren','Sakura','Umeko','Wen','Xian','Yuki','Akemi','Emiko','Hana',
      'Keiko','Lei','Nori','Pei','Suki','Ushi','Xue','Izumi','Chie','Hanae',
      'Kohaku','Masako','Tomoe','Tsukiko','Yuki',
    ],
    last: [
      'Kaijitsu','Amatatsu','Hirabayashi','Minkai','Kasai','Shojinawa','Wayama',
      'Tanaka','Nakamura','Yamamoto','Watanabe','Suzuki','Takahashi','Kobayashi',
      'Yoshida','Yamazaki','Matsumoto','Inoue','Chen','Wang','Zhang','Liu',
      'Huang','Zhou','Wu','Sun','Li','Yang','Kim','Park',
      'Jade','Lotus','Chrysanthemum','Bamboo','Crane','Dragon','Phoenix','Tiger',
      'Moonpetal','Stormcloud','Silkthread','Inkbrush','Tealeaf','Ricefield',
    ],
  },

  // Keleshite — Arabic/Persian, Qadira and Katheer
  Keleshite: {
    first: [
      'Aaqil','Bahram','Cyrus','Dariush','Eskandar','Farid','Gholamreza','Hafiz',
      'Ibrahim','Jahan','Kambiz','Laleh','Majid','Nasreen','Omar','Parviz',
      'Qadir','Rashid','Shahrazad','Tarek','Umayyah','Vahid','Wahid','Xerxes',
      'Yasmin','Zahra','Afsaneh','Behrouz','Cyra','Darius',
      'Esfandiar','Farzan','Golnar','Homa','Iman','Jalal','Kaveh','Leila',
      'Maryam','Nader','Omid','Parisa','Ramin','Sahar','Tahmineh','Vida',
      'Zarina','Ardeshir','Banu','Changiz','Delara','Ehsan','Firouzeh',
      'Gholam','Habib','Iraj','Jamshid',
    ],
    male: [
      'Aaqil','Bahram','Cyrus','Dariush','Eskandar','Farid','Gholamreza','Hafiz','Ibrahim',
      'Jahan','Kambiz','Majid','Omar','Parviz','Qadir','Rashid','Tarek','Umayyah','Vahid',
      'Wahid','Xerxes','Darius','Esfandiar','Farzan','Iman','Jalal','Kaveh','Nader','Omid',
      'Ramin','Ardeshir','Changiz','Ehsan','Gholam','Habib','Iraj','Jamshid','Karim','Levent',
    ],
    female: [
      'Laleh','Nasreen','Yasmin','Zahra','Afsaneh','Behrouz','Cyra','Golnar','Homa','Leila',
      'Maryam','Parisa','Sahar','Tahmineh','Vida','Zarina','Banu','Delara','Firouzeh','Asha',
      'Farah','Golestan','Hend','Imar','Jasmine','Kahari','Layla','Marziah','Niloufar','Parveen',
      'Qamar','Rabia','Scheherazade','Tala','Umara',
    ],
    last: [
      'al-Sahba','al-Hadid','al-Nasr','al-Zahir','ibn-Malik','ibn-Rashid',
      'al-Qadim','Padishah','Satrap','Vizier','Emir','Sultana',
      'Dawnfire','Desertwind','Dunewalker','Mirage','Oasis','Sandstorm',
      'Sirocco','Sunforge','Scimitar','Silkroad','Spicetrader','Starnavigator',
      'Moonwell','Golddust','Frankincense','Myrrh','Saffron','Cardamom',
      'Bazari','Caravansary','Minaret','Mosaic','Arabesque','Calligraphy',
      'al-Katib','al-Hakim','al-Batal','al-Amir','al-Wazir','al-Sayyid',
      'al-Ghazi','al-Faris','al-Dalil','al-Rawi',
    ],
  },

  // Garundi — North African, ancient Osirion civilization
  Garundi: {
    first: [
      'Amenhotep','Bastet','Cleopas','Djedkare','Eshe','Fenuku','Garai','Hatshepsut',
      'Imhotep','Jabari','Kamilah','Layla','Mensah','Nefertari','Osei','Palesa',
      'Quahadi','Rashidi','Salama','Taharqa','Ubaid','Valentina','Walidah','Xola',
      'Yasir','Zuberi','Abasi','Bahati','Chike','Dalila',
      'Emeka','Farida','Gyasi','Hasina','Ife','Jelani','Kofi','Lateefa',
      'Mosi','Nailah','Obioma','Paki','Raziya','Sefu','Tendai','Udo',
      'Zuri','Akila','Bomani','Chiamaka','Deka','Ekene','Femi','Ghali',
      'Habiba','Issa','Jumoke',
    ],
    male: [
      'Amenhotep','Cleopas','Djedkare','Fenuku','Garai','Imhotep','Jabari','Mensah',
      'Osei','Quahadi','Rashidi','Taharqa','Ubaid','Yasir','Zuberi','Abasi','Bahati',
      'Chike','Emeka','Gyasi','Jelani','Kofi','Mosi','Paki','Sefu','Tendai','Udo','Bomani',
      'Deka','Ekene','Femi','Ghali','Issa','Kamau','Kwame','Leonce','Masamba','Njoroge',
    ],
    female: [
      'Bastet','Eshe','Hatshepsut','Kamilah','Layla','Nefertari','Palesa','Salama',
      'Valentina','Walidah','Xola','Dalila','Farida','Hasina','Ife','Lateefa','Nailah',
      'Obioma','Raziya','Zuri','Akila','Chiamaka','Ekene','Habiba','Jumoke','Adanna',
      'Adimu','Amara','Ava','Chimara','Dada','Ebede','Folake','Nala','Zima',
    ],
    last: [
      'Osirian','Tephu','Wati','An-Hepsu','Khopesh','Pharaoh',
      'Sunborn','Sandking','Desertwalker','Nilecrest','Dunekeeper','Obelisk',
      'Pyramidion','Sphinxeye','Scarab','Ibis','Jackal','Crocodile',
      'Lotusborn','Papyrushand','Alabaster','Obsidian','Lapis','Jasper',
      'Goldmask','Sarcophagus','Canopic','Amethyst','Turquoise','Malachite',
      'Ankh','Djed','Wadjet','Uraeus','Benben','Cartouche',
      'el-Amarna','el-Luxor','el-Karnak','el-Thebes','el-Giza','el-Rashid',
    ],
  },

  // Mwangi — Sub-Saharan African, Mwangi Expanse
  Mwangi: {
    first: [
      'Abayomi','Bankole','Chidi','Danladi','Emeka','Folami','Gahiji','Haki',
      'Idowu','Jabari','Kunto','Lateef','Malaika','Nkechi','Olumide','Penda',
      'Rafiki','Sadiki','Talata','Uduak','Vashti','Wekesa','Yetunde','Zikomo',
      'Adaeze','Binta','Chinwe','Diallo','Ekon','Fatou',
      'Gameli','Hama','Ifeoma','Juma','Kamau','Lewa','Makena','Nia',
      'Onyeka','Panya','Sekou','Tafari','Uzoma','Wangari','Yusuf','Zahara',
      'Ayanna','Bemba','Chibuzo','Dayo','Efua','Fola',
      'Genet','Halima','Imani','Jengo',
    ],
    male: [
      'Abayomi','Bankole','Chidi','Danladi','Emeka','Folami','Gahiji','Haki','Idowu','Jabari',
      'Kunto','Lateef','Olumide','Rafiki','Sadiki','Uduak','Wekesa','Yusuf','Diallo','Ekon',
      'Gameli','Hama','Juma','Kamau','Lewa','Sekou','Tafari','Uzoma','Chibuzo','Femi','Kato',
      'Kwesi','Mandla','Osei','Thabo',
    ],
    female: [
      'Malaika','Nkechi','Penda','Yetunde','Zikomo','Adaeze','Binta','Chinwe','Fatou','Ifeoma',
      'Makena','Nia','Onyeka','Panya','Wangari','Zahara','Ayanna','Bemba','Dayo','Efua','Fola',
      'Genet','Halima','Imani','Jengo','Amara','Asha','Cheza','Dada','Ebele','Folake','Gemma',
      'Ife','Jada','Kachina','Zuri',
    ],
    last: [
      'Mwangi','Bekyar','Bonuwat','Zenj','Ijo','Bas\'o',
      'Junglewalker','Canopyclimber','Riverstrider','Rainkeeper','Thunderdrummer',
      'Sunblessed','Moonhunter','Starwatcher','Beastcaller','Spiritdancer',
      'Ancestorvoice','Elderspeaker','Griottale','Dreamshaper','Maskwearer',
      'Drumbeater','Spearcarrier','Shieldmaiden','Lionheart','Elephantsoul',
      'Rhinohide','Leopardswift','Crocodilejaw','Gorillafist','Hippoback',
      'Serpentwise','Eaglecry','Vulturewatch','Hyenalaugh','Zebrastripe',
      'Antelopeleap','Buffalostamp','Chameleonshift','Pangolinscale','Mantisarm',
    ],
  },

  // Vudrani — Indian subcontinent, Vudra
  Vudrani: {
    first: [
      'Arjun','Bhavna','Chandra','Devika','Eshan','Farha','Gauri','Harish',
      'Indira','Jayanti','Kiran','Lalita','Madhav','Nalini','Omkar','Padma',
      'Rajesh','Sanjay','Tara','Usha','Vimala','Yash','Ananda','Bala',
      'Chithra','Deepa','Ekanta','Govinda',
      'Hari','Ishani','Janaki','Kamala','Lakshmi','Mira','Nanda','Parvati',
      'Radha','Sita','Uma','Vasanti','Yamuna','Arun','Bharat','Daksha',
      'Ganesha','Hema','Ila','Jaya','Kavita','Leela','Maya','Nirmala',
      'Priya','Ravi','Shanti','Tulsi','Vijay','Zara',
    ],
    male: [
      'Arjun','Eshan','Harish','Madhav','Omkar','Rajesh','Sanjay','Yash','Ananda','Bala',
      'Govinda','Hari','Ravi','Arun','Bharat','Daksha','Ganesha','Vijay','Ashok','Deepak',
      'Girish','Hemant','Jai','Kannan','Lokesh','Murthy','Narayan','Pramod','Sandeep','Varun',
    ],
    female: [
      'Bhavna','Chandra','Devika','Farha','Gauri','Indira','Jayanti','Kiran','Lalita','Nalini',
      'Padma','Tara','Usha','Vimala','Chithra','Deepa','Ekanta','Ishani','Janaki','Kamala',
      'Lakshmi','Mira','Nanda','Parvati','Radha','Sita','Uma','Vasanti','Yamuna','Hema','Ila',
      'Jaya','Kavita','Leela','Maya','Nirmala','Priya','Shanti','Tulsi','Zara','Ashima',
    ],
    last: [
      'Domine','Domine','Rajput','Maharaja','Padaprajna','Chakravartin',
      'Goldenpalm','Lotusthrone','Silkrobe','Spicerider','Elephantlord',
      'Tigerstripe','Peacockfeather','Cobradance','Monsoon','Saffroncloak',
      'Sandalwood','Jasmine','Turmeric','Incense','Mantra','Sutra',
      'Vajra','Dharma','Karma','Moksha','Nirvana','Chakra',
      'Ganges','Indus','Brahmaputra','Narmada','Krishna','Godavari',
      'Devi','Patel','Sharma','Gupta','Verma','Singh','Kumar','Rao',
      'Nair','Menon','Pillai','Iyer',
    ],
  },

  // Taldan — Byzantine/Roman, old Taldor empire
  Taldan: {
    first: [
      'Adonius','Bellina','Caius','Domina','Eutropia','Flavius','Gaius','Helena',
      'Iulius','Justinia','Kaeso','Lucilla','Marcian','Nerva','Octavia','Portia',
      'Quintus','Regulus','Severina','Tiberius','Valeria','Maximus','Aurelia','Brutus',
      'Cassia','Decimus','Fausta','Gordian','Hadria','Justinian',
      'Livia','Nero','Otho','Petronia','Romulus','Sabina','Tacita','Ulpia',
      'Vespasia','Agrippina','Antonius','Bassianus','Cornelia','Diocles',
      'Elagabalus','Fulvia','Gratiana','Honorius','Invicta','Junia',
      'Karistus','Lepidus','Macrinus','Narcissus','Orchamus','Priscus',
      'Quietus','Rufinus','Septimia','Trajanus',
    ],
    male: [
      'Adonius','Caius','Flavius','Gaius','Iulius','Kaeso','Marcian','Nerva','Quintus',
      'Regulus','Tiberius','Maximus','Brutus','Decimus','Gordian','Justinian','Nero','Otho',
      'Romulus','Antonius','Bassianus','Diocles','Elagabalus','Honorius','Karistus','Lepidus',
      'Macrinus','Narcissus','Orchamus','Priscus','Quietus','Rufinus','Trajanus','Augustus',
    ],
    female: [
      'Bellina','Domina','Eutropia','Helena','Justinia','Lucilla','Octavia','Portia','Severina',
      'Valeria','Aurelia','Cassia','Fausta','Hadria','Livia','Petronia','Sabina','Tacita','Ulpia',
      'Vespasia','Agrippina','Cornelia','Fulvia','Gratiana','Invicta','Junia','Septimia','Aelia',
      'Antonia','Caelia','Claudia','Flavia','Juliana','Livia','Procula','Silvia','Terentia',
    ],
    last: [
      'Stavian','Karthis','Lotheed','Basri','Taldan','Oppara',
      'Aurelianus','Caesarius','Dominicus','Imperialis','Maxentius',
      'Nobilis','Patricius','Regalis','Senatorius','Tribunus',
      'Goldtoga','Purplecloak','Ironlaureate','Marblethrone','Ivorypalace',
      'Lionguard','Eaglecrest','Serpentsteel','Crowncaster','Scepterborne',
      'Consularis','Legatus','Praefectus','Centurion','Decurio',
      'Aquilifer','Praetorian','Vigilis','Optio','Signifer',
      'Palatine','Augustan','Flavian','Severan','Theodosian','Justinian',
    ],
  },
};


// ═══════════════════════════════════════════════════
//  RACE-BASED NAME POOLS
// ═══════════════════════════════════════════════════

const RANDOM_NAMES = {
  Human: {
    first: [
      'Valeros','Seelah','Ezren','Merisiel','Harsk','Lem','Kyra','Sajan','Amiri','Lini',
      'Aldric','Brenyn','Caelus','Dorin','Elara','Fiona','Gareth','Helena','Iona','Jorik',
      'Kael','Lyanna','Marten','Nyssa','Orik','Phaedra','Quirin','Reva','Soren','Talia',
      'Ulric','Vanya','Wren','Xanthe','Yoren','Zara','Aldern','Bethana','Cyrdak','Daviren',
      'Aerik','Brenna','Corlan','Desna','Edric','Fara','Gideon','Hestia','Ilyana','Jareth',
      'Alaric','Branwen','Cassius','Delara','Emeric','Freya','Godwin','Hadria','Isabeau','Jorund',
      'Kendrick','Lysara','Magnus','Nerissa','Osric','Petra','Quintus','Roslyn','Sigmar','Tanith',
      'Ulfric','Viveka','Wulfric','Yseult','Zariel','Artos','Briala','Cedric','Dahlia','Eamon',
      'Faolan','Giselle','Halvard','Isolde','Jorah','Kaira','Leoric','Mirabel','Nolan','Ondrea',
      'Perrin','Rowena','Stellan','Theron','Ursa','Vesper','Willem','Ximena','Yelena','Zephyr',
    ],
    male: [
      'Valeros','Ezren','Harsk','Lem','Sajan','Aldric','Brenyn','Caelus','Dorin','Gareth','Jorik',
      'Kael','Marten','Orik','Quirin','Soren','Ulric','Wren','Yoren','Aldern','Cyrdak','Daviren',
      'Aerik','Corlan','Edric','Gideon','Jareth','Alaric','Cassius','Emeric','Godwin','Jorund',
      'Kendrick','Magnus','Osric','Quintus','Sigmar','Ulfric','Wulfric','Artos','Cedric','Eamon',
      'Faolan','Halvard','Nolan','Perrin','Stellan','Theron','Willem','Zephyr','Adrian','Bartholomew',
    ],
    female: [
      'Seelah','Merisiel','Kyra','Amiri','Lini','Elara','Fiona','Helena','Iona','Lyanna','Nyssa',
      'Phaedra','Reva','Talia','Vanya','Xanthe','Zara','Bethana','Brenna','Desna','Fara','Hestia',
      'Ilyana','Branwen','Delara','Freya','Hadria','Isabeau','Lysara','Nerissa','Petra','Roslyn','Tanith',
      'Viveka','Yseult','Zariel','Briala','Dahlia','Giselle','Isolde','Jorah','Kaira','Leoric','Mirabel',
      'Ondrea','Rowena','Ursa','Vesper','Ximena','Yelena','Arlene','Beatrice','Celia','Edith','Faye',
    ],
    last: [
      'Orisini','Deverin','Foxglove','Kaijitsu','Vhiski','Scarnetti','Valdemar','Hemlock',
      'Ironbriar','Duskwalker','Wintrish','Corvane','Ashford','Blackerly',
      'Creed','Heidmarch','Jeggare','Kroft','Montlarion','Nox','Ornelos','Porphyria',
      'Radvir','Shadowcount','Thrune','Versade','Willowmere','Stormwind','Greycloak',
      'Aldren','Brastlewark','Caulborn','Drayven','Egorian','Falloway','Graymark','Halgrim',
      'Ilvari','Justmark','Kenabres','Lastwall','Magnimar','Northcrest','Ostenso','Pharasma',
      'Quendalon','Ravenhold','Surtova','Taldan','Uskwood','Valkner','Windsong','Xanthir',
      'Yorick','Zassrion','Aldori','Brevoy','Cinderlander','Deepmarket','Evondemor','Flameford',
    ],
  },
  Elf: {
    first: [
      'Aerindel','Caladrel','Elensar','Faelynn','Galinndan','Haelerin','Ilynara','Kaelith',
      'Lirael','Meliandre','Naelora','Paelias','Quelenna','Rylindel','Shalelu','Tessara',
      'Uldreyin','Vaelora','Wynriell','Arannis','Belarian','Cyrieth','Daellin','Elowen',
      'Faelar','Gaelira','Haelindar','Idrielle','Jaelynn','Korellon',
      'Aelindra','Brightwyn','Celanil','Daelorien','Eiravel','Fenvariel','Glynindel','Halanaestra',
      'Ireniel','Jhael','Kethryllia','Laerindel','Mythindel','Nelaeryn','Olorin','Phaeralith',
      'Quilindra','Raelithar','Silvenar','Thindaliel','Uthaeril','Vaeridel','Whisperwind','Xyleena',
      'Ylandris','Zaelindra','Aelindor','Brethilwen','Caelindra','Daemyra',
    ],
    male: [
      'Aerindel','Caladrel','Elensar','Galinndan','Haelerin','Lirael','Paelias','Rylindel','Uldreyin',
      'Wynriell','Arannis','Belarian','Cyrieth','Daellin','Faelar','Gaelira','Haelindar','Korellon',
      'Olorin','Raelithar','Silvenar','Thindaliel','Uthaeril','Vaeridel','Aelindor','Brethilwen','Eliodren',
      'Feydren','Galeran','Helion','Ixian','Jorren','Kaelen','Loriandel','Meidrarel','Nellanor','Orion',
    ],
    female: [
      'Faelynn','Ilynara','Kaelith','Meliandre','Naelora','Quelenna','Shalelu','Tessara','Vaelora',
      'Elowen','Idrielle','Jaelynn','Aelindra','Brightwyn','Celanil','Daelorien','Eiravel','Fenvariel',
      'Glynindel','Halanaestra','Ireniel','Jhael','Kethryllia','Laerindel','Mythindel','Nelaeryn',
      'Phaeralith','Quilindra','Xyleena','Ylandris','Zaelindra','Caelindra','Daemyra','Aerendel',
      'Brinelle','Celestria','Danthanis','Evangelis','Fayenna',
    ],
    last: [
      'Amakiir','Brightleaf','Cyphren','Dawnwhisper','Erevan','Farsong','Galanodel',
      'Holimion','Ilphukiir','Liadon','Meliamne','Nailo','Quillathe','Siannodel',
      'Starweaver','Treewalker','Virran','Windrunner','Xiloscient','Moonshadow',
      'Alenuath','Birdsong','Crystalmere','Duskmantle','Eveningstar','Feywarden','Greensong',
      'Highbranch','Ithildin','Joyriver','Keenwind','Leafwhirl','Moonbow','Nightbreeze',
      'Oakenshield','Petalfall','Quenesti','Rivensong','Sunhallow','Thornbloom',
    ],
  },
  Dwarf: {
    first: [
      'Balin','Dagna','Dolgrin','Elga','Fergal','Gronak','Helga','Ingra','Jolgrim',
      'Kharag','Losk','Morga','Norgrim','Olfin','Poldra','Rangrim','Sigrun','Torag',
      'Ulfgar','Vondal','Agrit','Bolhild','Citrine','Duerga','Eberk','Falkrunn',
      'Gurdis','Hjalmur','Ilde','Kettil',
      'Adrik','Bardryn','Dagnal','Ermin','Fargrim','Gardain','Harbek','Ilga','Jorna',
      'Kotri','Litrin','Mardred','Nordak','Orsik','Pikel','Rurik','Stonehelm','Thoradin',
      'Ulfhild','Vistra','Whurbin','Audhild','Brokk','Cadderly','Diesa','Eldeth','Finellen',
      'Gunnloda','Hlin','Inga','Kathra',
    ],
    male: [
      'Balin','Dolgrin','Fergal','Gronak','Jolgrim','Kharag','Losk','Norgrim','Olfin','Rangrim',
      'Torag','Ulfgar','Vondal','Agrit','Eberk','Gurdis','Hjalmur','Kettil','Adrik','Bardryn',
      'Dagnal','Ermin','Fargrim','Gardain','Harbek','Kotri','Litrin','Mardred','Nordak','Orsik',
      'Pikel','Rurik','Stonehelm','Thoradin','Whurbin','Brokk','Cadderly','Borin','Durin','Hardin',
      'Thorin','Urdak','Varin','Yorgrim',
    ],
    female: [
      'Dagna','Elga','Helga','Ingra','Morga','Poldra','Sigrun','Bolhild','Citrine','Duerga',
      'Falkrunn','Ilga','Jorna','Ulfhild','Vistra','Audhild','Diesa','Eldeth','Finellen','Gunnloda',
      'Hlin','Inga','Kathra','Astrid','Bjora','Dagma','Eira','Frida','Greta','Hilda','Jurga',
      'Kera','Lorina','Marta','Nala','Orna','Petra','Ragna','Signe','Torina','Ursa',
    ],
    last: [
      'Ironforge','Steelhand','Stoneshield','Darkmine','Fireheart','Goldbeard',
      'Hammerfall','Ironfoot','Janderhoff','Kraggodan','Lodestone','Mithralvein',
      'Onyxarm','Pebbleback','Quartzhelm','Runecarver','Silverpick','Thunderbrow',
      'Underhill','Wyrmslayer',
      'Anvilmar','Boulderback','Coppervein','Deepdelver','Earthsong','Forgefire','Granitfist',
      'Hardrock','Irongut','Jewelbeard','Keenaxe','Leadfoot','Moltenmaw','Nickelpick',
      'Orehammer','Peakclimber','Quartzcutter','Rumblefoot','Steelbraid','Tunnelward',
    ],
  },
  Halfling: {
    first: [
      'Agna','Bilbo','Corrin','Drina','Eldon','Filana','Garret','Hilara','Idda',
      'Jasper','Kithri','Lidda','Merric','Nedda','Osborn','Paela','Qillathe','Roscoe',
      'Seraphina','Torbil','Ulric','Vani','Wellby','Xara','Yolanda','Zook',
      'Andri','Brandy','Callie','Dalton',
      'Alton','Beau','Cade','Daphne','Eran','Floria','Gordy','Hilda','Ivy','Jenkin',
      'Knox','Lavinia','Milo','Nessa','Olive','Pip','Quinn','Rosalind','Sage','Trotter',
      'Umber','Violet','Wander','Yarrow','Zinnia','Alby','Bramble','Cherry','Dewdrop','Ember',
    ],
    male: [
      'Bilbo','Corrin','Eldon','Garret','Jasper','Merric','Osborn','Roscoe','Torbil','Ulric',
      'Wellby','Zook','Andri','Dalton','Alton','Beau','Cade','Eran','Gordy','Jenkin','Knox',
      'Milo','Pip','Trotter','Umber','Wander','Alby','Bramble','Dewdrop','Pippin','Reggie',
      'Samwise','Tibo','Wilfred','Borin','Conlan',
    ],
    female: [
      'Agna','Drina','Filana','Hilara','Idda','Kithri','Lidda','Nedda','Paela','Qillathe',
      'Seraphina','Vani','Xara','Yolanda','Brandy','Callie','Daphne','Floria','Hilda','Ivy',
      'Lavinia','Nessa','Olive','Quinn','Rosalind','Sage','Violet','Yarrow','Zinnia','Cherry',
      'Ember','Rosie','Sadie','Suzy','Tammy','Valerie','Wendy',
    ],
    last: [
      'Brushgather','Goodbarrel','Greenbottle','Hilltopple','Leagallow','Littlefoot',
      'Nimblefingers','Tealeaf','Thorngage','Tosscobble','Underbough','Warmwater',
      'Brightmoon','Fastfoot','Glenfellow','Highhill','Lightfingers','Merryweather',
      'Quickstep','Shadowstep',
      'Appleblossom','Brownburrow','Copperkettle','Daisychain','Elderberry','Fernhollow',
      'Goldwheat','Honeydew','Ivybrook','Jumblefoot','Kettlewhistle','Larkspur',
      'Meadowlark','Nutbrown','Oakbottom','Puddlejump','Quillback','Riverstone',
      'Sunpetal','Thistledown',
    ],
  },
  Gnome: {
    first: [
      'Aballin','Bimble','Carlin','Dimble','Ellywick','Frug','Gerbo','Hickle','Ipswitch',
      'Jebeddo','Kellen','Lini','Maalthiir','Namfoodle','Orryn','Pock','Qualen','Roondar',
      'Seebo','Timmander','Wrenn','Zanna','Alston','Breena','Calden','Dabble',
      'Fenthwick','Gimble','Halia','Inkle',
      'Addlepate','Boffin','Crumpet','Dazzle','Elfinook','Fibble','Glimmer','Hoobus','Izzik',
      'Jangle','Kelwick','Locket','Mumble','Nyx','Oddwick','Pintip','Quibble','Razzle',
      'Sprockett','Twiddle','Umbriel','Vexle','Wobblecog','Xizzle','Yipwick','Zibble',
      'Alwick','Bumble','Cogsworth','Dinkle',
    ],
    male: [
      'Aballin','Bimble','Carlin','Dimble','Frug','Gerbo','Hickle','Ipswitch','Jebeddo','Kellen',
      'Maalthiir','Namfoodle','Orryn','Pock','Qualen','Roondar','Seebo','Timmander','Wrenn','Alston',
      'Calden','Fenthwick','Gimble','Inkle','Addlepate','Boffin','Crumpet','Dazzle','Elfinook','Fibble',
      'Glimmer','Hoobus','Izzik','Jangle','Kelwick','Locket','Mumble','Oddwick','Pintip','Quibble',
    ],
    female: [
      'Ellywick','Lini','Zanna','Breena','Dabble','Halia','Crumpet','Dazzle','Glimmer','Locket',
      'Nyx','Razzle','Twiddle','Umbriel','Vexle','Wobblecog','Xizzle','Yipwick','Zibble','Bumble',
      'Cogsworth','Dinkle','Bella','Chime','Copper','Dotty','Edith','Feather','Gizmo','Hazel',
      'Iris','Jinks','Kit','Lily','Maggie','Nettle','Olive','Piper','Rosie','Sunny',
    ],
    last: [
      'Beren','Clocksprocket','Daergel','Fizzlebang','Garrick','Humperdink','Ironquill',
      'Joyspring','Knackle','Loopwidget','Murnig','Nackle','Raulnor','Scheppen',
      'Stumbleduck','Tinkertop','Waywocket','Wildwander','Zilberstein','Cogsworth',
      'Banglebolt','Coppercoil','Dinglespring','Fiddlesticks','Gearspark','Hobnobble',
      'Inkblot','Jitterbug','Kettlebottom','Loontwist','Mirthquake','Noodlewick',
      'Oddsprocket','Puddlejumper','Quirkwhistle','Rattlechain','Sizzlecrank','Twizzlepop',
      'Whirligig','Zappledash',
    ],
  },
  'Half-Elf': {
    first: [
      'Aerel','Brelynn','Calathes','Darien','Erevan','Fael','Galinndan','Haelis',
      'Ilanis','Jaelara','Kaelen','Lyris','Maelis','Nyara','Orynn','Phaedrus',
      'Quen','Rael','Sylara','Taerin','Vaelin','Wyndara','Alara','Baelis',
      'Caewen','Daelion','Elowen','Faelyn','Gaelin','Harion',
      'Adresin','Belarien','Cylanis','Daeris','Erethiel','Faelinor','Galadren','Helisara',
      'Ithaniel','Jasmiel','Kaelorin','Lyrindel','Maethran','Naerith','Olorien','Phaeris',
      'Quenara','Raethiel','Silvaren','Taelorin','Uthien','Valanthe','Wyrenna','Xaelin',
      'Yasmira','Zaelorin','Aelith','Braelen','Cerindal','Daelara',
    ],
    male: [
      'Aerel','Darien','Erevan','Fael','Galinndan','Haelis','Jaelara','Kaelen','Orynn','Phaedrus',
      'Quen','Rael','Taerin','Vaelin','Alara','Daelion','Gaelin','Harion','Adresin','Belarien',
      'Cylanis','Daeris','Erethiel','Faelinor','Galadren','Ithaniel','Jasmiel','Kaelorin','Maethran',
      'Naerith','Olorien','Phaeris','Raethiel','Silvaren','Taelorin','Uthien','Xaelin','Zaelorin',
    ],
    female: [
      'Brelynn','Calathes','Erevan','Galinndan','Ilanis','Jaelara','Lyris','Maelis','Nyara','Sylara',
      'Vaelin','Wyndara','Baelis','Caewen','Daelion','Elowen','Faelyn','Helisara','Jasmiel','Lyrindel',
      'Naerith','Phaeris','Quenara','Raethiel','Silvaren','Taelorin','Valanthe','Wyrenna','Yasmira',
      'Zaelorin','Aelith','Cerindal','Daelara','Aerindel','Brethil','Elanor','Galadriel','Haleth',
    ],
    last: null,
  },
  'Half-Orc': {
    first: [
      'Akra','Brug','Crag','Dench','Eruk','Feng','Gell','Henk','Imsh','Jurk',
      'Krusk','Lhurk','Mhurren','Neega','Ownka','Prug','Rath','Shump','Thokk','Urzul',
      'Varg','Wurg','Yurk','Zegga','Ausk','Brukk','Droga','Ekk','Gorrum','Hakka',
      'Azgrul','Brakka','Crull','Durge','Enok','Fraga','Grumsh','Hurk','Iglak','Jurrg',
      'Krogga','Lugdush','Morgash','Nurgal','Ogg','Prukk','Ragash','Skagg','Tusk','Urrga',
      'Vrakk','Wulgar','Yargg','Zugga','Ashka','Bulga','Crega','Draxa','Ezka','Fenra',
    ],
    male: [
      'Brug','Crag','Dench','Eruk','Feng','Gell','Henk','Imsh','Jurk','Krusk','Lhurk','Mhurren',
      'Prug','Rath','Shump','Thokk','Urzul','Varg','Wurg','Yurk','Ausk','Brukk','Droga','Ekk',
      'Gorrum','Hakka','Azgrul','Brakka','Crull','Durge','Enok','Fraga','Grumsh','Hurk','Iglak',
      'Jurrg','Krogga','Lugdush','Morgash','Nurgal','Ogg','Prukk','Ragash','Skagg','Tusk','Urrga',
    ],
    female: [
      'Akra','Neega','Ownka','Zegga','Ashka','Bulga','Crega','Draxa','Ezka','Fenra','Ghessa',
      'Harka','Iskra','Jova','Kasha','Lorna','Morga','Nassa','Olga','Pesha','Quilla','Rasha',
      'Sasha','Tessa','Ursa','Vesna','Wanda','Ximara','Yasna','Zura',
    ],
    last: [
      'Ashfist','Bloodtusk','Crushbone','Doomhammer','Earthbreaker','Fleshrender',
      'Gorefang','Hellscream','Ironhide','Jawbreaker','Knifetooth','Longtusk',
      'Mauler','Nightfang','Orcslayer','Rageclaw','Skullsplitter','Thundermaw',
      'Vilefang','Warbringer',
      'Axegrind','Bonecrusher','Cinderjaw','Deathgrip','Eyegouger','Frostbite',
      'Gutripper','Headtaker','Ironfang','Jawsnapper','Killspear','Lashclaw',
      'Marrowchew','Neckbreaker','Oneslash','Pitfighter','Ripjaw','Scarmaker',
      'Tombcrusher','Warscream',
    ],
  },

  // ═══════════════════════════════════════════════════
  //  EXPANDED / UNCOMMON RACES
  // ═══════════════════════════════════════════════════

  Aasimar: {
    first: [
      'Arueshalae','Balazar','Celeste','Dawnara','Elysiel','Felanthia','Gloriel','Halorin',
      'Iridessa','Jophiel','Keriel','Luminara','Metatiel','Nethys','Orisiel','Pariel',
      'Queraphim','Raziel','Seraphina','Tyriel','Urathiel','Vashiel','Wyrhta','Xariel',
      'Yuliel','Zariel','Abaliel','Beshiel','Cassiel','Dameriel',
    ],
    male: [
      'Balazar','Halorin','Jophiel','Nethys','Pariel','Queraphim','Raziel','Tyriel','Urathiel',
      'Vashiel','Xariel','Abaliel','Beshiel','Cassiel','Dameriel','Azrael','Ezekiel','Gabriel',
      'Haniel','Ithuriel','Raguel','Saraqael','Selaphiel','Usiel','Zadkiel',
    ],
    female: [
      'Arueshalae','Celeste','Dawnara','Elysiel','Felanthia','Gloriel','Iridessa','Keriel',
      'Luminara','Metatiel','Orisiel','Seraphina','Wyrhta','Yuliel','Zariel','Abaliel','Cassiel',
      'Ariel','Auriel','Camael','Cassidy','Chamuel','Esther','Gideon','Hanael','Israfil',
      'Jeremiel','Kasdaye','Lahash','Michaela','Naamah','Ophiel','Peniel','Ragella','Sachiel',
    ],
    last: [
      'Dawnborn','Lightbringer','Gracefall','Halowing','Celestine','Divinus',
      'Goldenwing','Heavensent','Radiance','Solara','Starbright','Glorybound',
      'Holyfire','Sanctus','Brighthelm','Dawnforge','Pearlglow','Silverhalo',
      'Truegrace','Whitegold',
    ],
  },
  Tiefling: {
    first: [
      'Abaddon','Beleth','Caim','Damien','Ereshkigal','Faust','Graz\'zt','Hexia',
      'Infernus','Jezebel','Kyton','Lilura','Malachar','Nyx','Oriax','Perdition',
      'Ravenna','Styx','Tartarus','Umbra','Vexor','Wrath','Xaphan','Yscira',
      'Zarathus','Ashmedai','Belial','Cressida','Duskara','Emberlyn',
    ],
    male: [
      'Abaddon','Beleth','Caim','Damien','Faust','Graz\'zt','Infernus','Kyton','Malachar','Oriax',
      'Styx','Tartarus','Umbra','Vexor','Wrath','Xaphan','Zarathus','Ashmedai','Belial','Duskara',
      'Asmodan','Azura','Draven','Erebus','Gidim','Hellion','Ixion','Khaos','Malachor','Nocturne',
      'Pazuzu','Shazrakhan','Vexor','Yaqub','Zabkiel',
    ],
    female: [
      'Ereshkigal','Graz\'zt','Hexia','Jezebel','Lilura','Nyx','Perdition','Ravenna','Yscira',
      'Cressida','Duskara','Emberlyn','Azura','Belladona','Charm','Devilania','Elowen','Felicity',
      'Gidget','Helia','Inferna','Jalena','Kasandra','Lilith','Mara','Nephara','Oliana','Pheodra',
      'Raven','Selena','Talia','Valdina','Xenia','Zara','Zephyra',
    ],
    last: [
      'Ashborn','Brimstone','Cindersoul','Darkblood','Emberheart','Fiendmark',
      'Grimshaw','Hellspawn','Infernal','Jetflame','Knellborn','Lostgrace',
      'Mournsong','Nightpact','Omenborn','Pitblood','Ruinmark','Soulbrand',
      'Thornblood','Voidtouched',
    ],
  },
  Orc: {
    first: [
      'Agrash','Bolog','Crug','Dokk','Erash','Frug','Grishnak','Harg',
      'Igruk','Jukk','Krag','Lunk','Mog','Nugg','Olog','Prug',
      'Ragash','Skrag','Thrug','Ugg','Vash','Wrog','Yagga','Zugg',
      'Azog','Bolg','Durbag','Ghash','Gorbag','Muzgash',
    ],
    male: [
      'Agrash','Bolog','Crug','Dokk','Erash','Frug','Grishnak','Harg','Igruk','Jukk','Krag',
      'Lunk','Mog','Nugg','Olog','Prug','Ragash','Skrag','Thrug','Ugg','Vash','Wrog','Zugg',
      'Azog','Bolg','Durbag','Ghash','Gorbag','Muzgash','Bagnar','Drogoth','Gruumsh','Hok',
      'Jorgun','Karthus','Lugal','Morgrim','Narthug',
    ],
    female: [
      'Yagga','Agra','Basha','Cassa','Dasha','Erga','Franka','Ghara','Haska','Irka','Jassa',
      'Kasha','Lurga','Morga','Nasha','Orga','Pasha','Ragga','Sasha','Tasha','Urga','Vasha',
      'Warsha','Yamara','Zarla','Asha','Bella','Chara','Dara','Eska','Ferda','Gorga',
      'Harsha','Irsha','Kiska','Latka','Marka',
    ],
    last: [
      'Bonegnaw','Crushskull','Deathscream','Eyebiter','Fleshripper','Goreclaw',
      'Headspike','Irongore','Jawrend','Killcrush','Legsnap','Maulbone',
      'Neckchew','Orcsbane','Pitscream','Ragefist','Skullchew','Tuskbreak',
      'Vileclaw','Warblood',
    ],
  },
  Catfolk: {
    first: [
      'Amara','Bastet','Chetari','Damira','Elosha','Felasi','Grishan','Hashra',
      'Ixala','Jamira','Keshala','Lashani','Mirashi','Neshala','Orishka','Purisha',
      'Rashani','Sashala','Tashiri','Urishka','Vashani','Weshala','Xashiri','Yalani',
      'Zeshara','Ashani','Brishka','Chalani','Dashiri','Elashi',
    ],
    male: [
      'Chetari','Grishan','Ixala','Jamira','Mirashi','Orishka','Rashani','Tashiri','Urishka',
      'Vashani','Xashiri','Ashani','Brishka','Chalani','Dashiri','Elashi','Arshan','Faden','Hashan',
      'Jashni','Keshani','Lashir','Mordan','Nashir','Oishar','Pashar','Rashir','Sashir','Tahir',
    ],
    female: [
      'Amara','Bastet','Damira','Elosha','Felasi','Hashra','Keshala','Lashani','Neshala','Purisha',
      'Sashala','Yalani','Zeshara','Weshala','Alesha','Bahira','Cassia','Darisha','Eliana','Farrah',
      'Gasha','Hesha','Ishara','Jalisa','Kaisha','Lysha','Masara','Nasha','Oliana','Pasha',
    ],
    last: [
      'Brightpaw','Copperclaw','Duskfur','Embertail','Fleetfoot','Goldwhisker',
      'Hawkeye','Ivorycoat','Jadestripe','Keensight','Longwhisker','Moonpelt',
      'Nightstalk','Opalclaw','Purrtongue','Quickpounce','Razorpaw','Silkfur',
      'Swiftclaw','Tigereye',
    ],
  },
  Kitsune: {
    first: [
      'Akemi','Chiyo','Daiki','Emiko','Fujiko','Genko','Haruki','Isamu',
      'Junko','Kaede','Lumi','Mikio','Natsuki','Orihime','Renko','Sakuya',
      'Tamamo','Umeko','Yoko','Zenko','Aoi','Hoshi','Inari','Kohaku',
      'Masumi','Nozomi','Rika','Sora','Tsuki','Yuri',
    ],
    male: [
      'Daiki','Genko','Haruki','Isamu','Kaede','Mikio','Renko','Yoko','Zenko','Kohaku',
      'Masumi','Sora','Takeshi','Akira','Daichi','Eiji','Fumitaka','Genji','Haruto','Ichiro',
      'Jiro','Kaisuke','Lucian','Masaru','Noboru','Osamu','Raiden','Saburo','Tadao','Unami',
    ],
    female: [
      'Akemi','Chiyo','Emiko','Fujiko','Junko','Lumi','Natsuki','Orihime','Sakuya','Tamamo',
      'Umeko','Aoi','Hoshi','Inari','Masumi','Nozomi','Rika','Tsuki','Yuri','Akane','Amaya',
      'Chie','Daisuki','Erika','Fumie','Gema','Hana','Isami','Junuyo','Kaoru','Kyoko',
    ],
    last: [
      'Foxfire','Moonbrush','Ninetails','Silvertail','Starfox','Twilightfur',
      'Willowtail','Mistcoat','Dawnpelt','Shadowbrush','Ghostfur','Jadepaw',
      'Redleaf','Goldenmask','Autumncoat','Spiritfox','Dreamtail','Echotread',
      'Shinetail','Windwhisker',
    ],
  },
  Tengu: {
    first: [
      'Arakaki','Corvus','Daikoku','Eriku','Featherik','Garuda','Hakutaku','Itachi',
      'Jinmu','Karasu','Mukuro','Noburu','Oniwaka','Raijin','Shikaku','Takumi',
      'Uzumaki','Ventus','Windego','Yamato','Zankoku','Akumu','Benkei','Crow',
      'Duskfeather','Ebonwing','Flockmaster','Grimtalon','Haiku','Inkfeather',
    ],
    male: [
      'Arakaki','Corvus','Daikoku','Eriku','Featherik','Garuda','Hakutaku','Itachi','Jinmu','Karasu',
      'Mukuro','Noburu','Oniwaka','Raijin','Shikaku','Takumi','Uzumaki','Ventus','Windego','Yamato',
      'Zankoku','Akumu','Benkei','Crow','Duskfeather','Ebonwing','Flockmaster','Grimtalon','Haiku',
      'Inkfeather','Ashcrow','Blackbeak','Crowclaw','Darkwing','Ebonflight',
    ],
    female: [
      'Arakaki','Daikoku','Hakutaku','Karasu','Oniwaka','Shikaku','Uzumaki','Ventus','Windego',
      'Zankoku','Akumu','Benkei','Duskfeather','Ebonwing','Flockmaster','Grimtalon','Haiku','Inkfeather',
      'Akane','Chiyo','Daria','Emiru','Fumie','Geni','Hana','Iishi','Junko','Kaida','Kiriko',
      'Leilani','Mayako','Noriko','Osamu','Petronella','Raven','Sakura','Taina','Undine',
    ],
    last: [
      'Blackbeak','Crowcall','Darkwing','Ebonfeather','Flightstorm','Grimtalon',
      'Highsoar','Inkplume','Jadeclaw','Keentalon','Longshadow','Murkwing',
      'Nightbeak','Onyxfeather','Plumecrest','Ravendive','Stormwing','Swifttalon',
      'Thundercaw','Windscream',
    ],
  },
  Ratfolk: {
    first: [
      'Arat','Bisk','Cheska','Drib','Eeka','Fitch','Gnaw','Hisk',
      'Isk','Jink','Krik','Lisk','Misk','Nisk','Orik','Pisk',
      'Quik','Rik','Skrit','Tisk','Usk','Vik','Wisk','Xik',
      'Yisk','Zisk','Chitter','Dusk','Ember','Flick',
    ],
    male: [
      'Arat','Bisk','Drib','Fitch','Gnaw','Hisk','Isk','Jink','Krik','Lisk','Misk','Nisk','Orik',
      'Pisk','Quik','Rik','Skrit','Tisk','Usk','Vik','Wisk','Xik','Zisk','Chitter','Flick',
      'Rask','Snik','Tak','Vix','Warek','Yak','Critch','Dribb','Friz','Grik',
    ],
    female: [
      'Cheska','Eeka','Yisk','Ember','Chitta','Cessa','Diska','Fessa','Gitta','Haska','Iska',
      'Jessa','Kessa','Lessa','Missa','Nissa','Pissa','Ressa','Sissa','Tessa','Ussa','Vissa',
      'Wessa','Xessa','Yessa','Zessa','Ashka','Betka','Cheka','Drika','Esska','Fritka',
    ],
    last: [
      'Brighteyes','Cheesewhisker','Dirtdigger','Dustnose','Fasttail','Greypelt',
      'Holefinder','Inkwhisker','Junktinker','Keennose','Loosecoin','Mudpaw',
      'Nighteyes','Opensack','Pipesqueak','Quicknibble','Rattail','Sharpteeth',
      'Tunnelrat','Wiretail',
    ],
  },
  Nagaji: {
    first: [
      'Assama','Bhisaj','Charuth','Drasha','Essara','Fassith','Ghissra','Hassak',
      'Issara','Jassith','Kassara','Lissath','Massith','Nassara','Ossira','Passek',
      'Rassith','Sassara','Tassik','Ussara','Vassith','Wassek','Xassira','Yassith',
      'Zassara','Ashssar','Brassik','Cressith','Drassara','Essrik',
    ],
    male: [
      'Bhisaj','Charuth','Drasha','Fassith','Ghissra','Hassak','Jassith','Lissath','Massith','Ossira',
      'Passek','Rassith','Tassik','Ussara','Vassith','Wassek','Yassith','Ashssar','Brassik','Essrik',
      'Ashir','Behir','Charaka','Dasak','Essath','Fassir','Gashir','Hasir','Jasir','Kashir',
      'Lassir','Mashir','Nassir','Passir','Rashir',
    ],
    female: [
      'Assama','Essara','Ghissra','Issara','Kassara','Nassara','Sassara','Xassira','Zassara',
      'Cressith','Drassara','Ashara','Bashira','Chasara','Dashira','Essima','Fassima','Ghasara',
      'Hashira','Jasara','Kashara','Lassara','Mashara','Nassara','Pasara','Rashara','Sassira',
      'Tassara','Vassara','Wassara','Yasara','Zassira',
    ],
    last: [
      'Coilfang','Duskscale','Emberfang','Greenvenom','Hooded','Ironscale',
      'Jadeeye','Kingcobra','Longfang','Moltscale','Nightvenom','Opalscale',
      'Pitfang','Queenserpent','Razorfang','Scaleguard','Tongueflick','Viperblood',
      'Wyrmscale','Zenithscale',
    ],
  },
  Changeling: {
    first: [
      'Ashlynn','Briar','Corvina','Dusk','Eire','Fogwyn','Gloom','Hagryn',
      'Isolde','Jinx','Kestrel','Luna','Muriel','Nyx','Ondine','Phoebe',
      'Raven','Sable','Thorn','Umber','Vesper','Wren','Xylia','Yew',
      'Zinnia','Alder','Belladonna','Cypress','Dahlia','Elm',
    ],
    male: [
      'Briar','Dusk','Fogwyn','Gloom','Hagryn','Kestrel','Muriel','Ondine','Raven','Thorn','Umber',
      'Wren','Alder','Cypress','Elm','Ash','Birch','Fir','Hazel','Oak','Pine','Sage','Thistle',
      'Ashton','Bramble','Crescent','Damon','Ebon','Fallow','Grendel','Hadrian','Isidor',
      'Jericho','Kasper','Lorne','Mortus','Noctus','Obsidian','Phantom','Quirk','Raven',
    ],
    female: [
      'Ashlynn','Corvina','Eire','Isolde','Jinx','Luna','Muriel','Nyx','Phoebe','Sable','Vesper',
      'Xylia','Yew','Zinnia','Belladonna','Dahlia','Calamity','Charity','Despair','Eglantine',
      'Fable','Grendela','Hag','Iris','Jinxia','Kerosene','Lilith','Moonlight','Nightshade',
      'Onyx','Phantom','Quirella','Ravenna','Spellbind','Tempest','Undine','Vanessa','Wisteria',
    ],
    last: [
      'Ashveil','Blackthorn','Crowhag','Duskmother','Eyeless','Fogborn',
      'Grimhex','Hagsblood','Ironteeth','Jadehex','Knottwig','Lurk',
      'Moonhag','Nightveil','Owlcurse','Plaguehex','Ravenmark','Shadowhex',
      'Thornborn','Witchblood',
    ],
  },
  Dhampir: {
    first: [
      'Adrian','Blood','Caine','Draven','Erasmus','Fenris','Gideon','Helena',
      'Ichabod','Jericho','Kael','Lucian','Mordecai','Nikolai','Orion','Phaedra',
      'Quinn','Ravenwood','Seras','Theron','Umbra','Vladimir','Wynn','Xander',
      'Ysmael','Zephyrus','Alarice','Belmont','Corvinus','Drusilla',
    ],
    male: [
      'Adrian','Blood','Caine','Draven','Erasmus','Fenris','Gideon','Ichabod','Jericho','Kael',
      'Lucian','Mordecai','Nikolai','Orion','Quinn','Ravenwood','Theron','Umbra','Vladimir','Wynn',
      'Xander','Ysmael','Zephyrus','Belmont','Corvinus','Damian','Ezra','Felix','Grigor','Heinrich',
      'Ivan','Joachim','Konstantin','Leopold','Mikhael','Nathaniel','Oberon','Percival','Raphael',
    ],
    female: [
      'Helena','Phaedra','Seras','Alarice','Drusilla','Ariadne','Beatrice','Cassandra','Diana',
      'Evangeline','Felicity','Genevieve','Hestia','Isabelle','Josephine','Katarina','Lilith',
      'Margot','Natasha','Ophelia','Persephone','Rosalind','Seraphine','Tatiana','Valentina',
      'Veronica','Yvonne','Zephyra','Adrienne','Bridget','Celestina','Domina','Estelle',
    ],
    last: [
      'Ashblood','Blackthorn','Crimsonveil','Darkholme','Everdusk','Fangborn',
      'Gravesend','Hollowborn','Iceblood','Jadecrypt','Knightshade','Lifedrinker',
      'Moonblood','Nighthollow','Paleblood','Rosethrone','Sanguine','Tombheart',
      'Umbraveil','Veinwalker',
    ],
  },
  Fetchling: {
    first: [
      'Ashael','Bleakwyn','Crepusc','Dimara','Ebon','Faderis','Gloomara','Hazael',
      'Inkara','Jettyn','Kaelum','Limbra','Murkel','Noctis','Obsidian','Penumbra',
      'Quietus','Ravn','Silhouette','Tenebris','Umbriel','Voidara','Wraith','Xerias',
      'Yawning','Zephyrdark','Ashara','Duskael','Eclipsa','Phantara',
    ],
    male: [
      'Ashael','Bleakwyn','Crepusc','Ebon','Faderis','Hazael','Jettyn','Kaelum','Murkel','Noctis',
      'Obsidian','Quietus','Ravn','Tenebris','Umbriel','Wraith','Xerias','Zephyrdark','Duskael',
      'Ashkar','Blacken','Cravus','Darkane','Ebonheart','Fademus','Gloomclaw','Havenless',
      'Inkheart','Jadevoid','Kevlar','Limboborn','Mortis','Nightborn','Omen','Penitent','Quietane',
    ],
    female: [
      'Dimara','Gloomara','Inkara','Limbra','Silhouette','Voidara','Yawning','Ashara','Eclipsa',
      'Phantara','Abyss','Blaspheme','Cresent','Darkess','Ebon','Fadelight','Gloomess','Hazel',
      'Iska','Jessa','Keisha','Limara','Moresca','Nightesa','Omara','Penumbrial','Quietess',
      'Ravenna','Shadessa','Tenebressa','Umbriel','Void','Wisteria','Xerophile','Yessinia','Zara',
    ],
    last: [
      'Darkrift','Ebontide','Fadewalker','Gloomborn','Halflight','Inkwell',
      'Jetstream','Murkwater','Nightrift','Obsidius','Penumbral','Shadowmere',
      'Silhouex','Twilightborn','Umbranox','Voidwalker','Wraithmist',
      'Duskveil','Eclipsion','Nethervoid',
    ],
  },
  Ifrit: {
    first: [
      'Ashara','Blazius','Cinder','Djarinn','Embera','Flashfire','Glowheart','Heathen',
      'Ignatius','Javal','Kindra','Lavara','Magmus','Naphtha','Oxfire','Pyriel',
      'Radiance','Scoria','Torchara','Ushira','Vulcania','Warmth','Xeric','Yashfire',
      'Zenith','Ashkin','Brimora','Charyn','Drakefire','Eruptia',
    ],
    male: [
      'Blazius','Cinder','Djarinn','Flashfire','Glowheart','Heathen','Ignatius','Javal',
      'Magmus','Naphtha','Oxfire','Pyriel','Scoria','Ushira','Warmth','Xeric','Zenith','Ashkin',
      'Charyn','Drakefire','Ashborn','Blaze','Cendra','Drago','Embark','Ferno','Glare','Heat',
      'Inferno','Jalus','Kessir','Lava','Magnis','Napalm','Onyx','Pyrax','Searing','Torchus',
    ],
    female: [
      'Ashara','Embera','Kindra','Lavara','Radiance','Torchara','Vulcania','Yashfire','Brimora',
      'Eruptia','Amber','Blaze','Cinders','Ember','Fira','Glare','Heat','Inferna','Jasmine','Kindre',
      'Lavina','Magma','Naphtalia','Ophelia','Pyressa','Scoria','Torchella','Ushira','Vulcana',
      'Warmth','Xyria','Yasmine','Zenara','Ashella','Brazelle','Cindra','Drakella','Erupta',
    ],
    last: [
      'Ashborn','Blazeheart','Cindermark','Dragonflame','Embersteel','Firebrand',
      'Glassheart','Hearthfire','Infernus','Lavablood','Moltencore','Novaflare',
      'Obsidiflame','Pyreborn','Scorchmark','Sparkforge','Torchbearer','Volcanist',
      'Wildfire','Zenithblaze',
    ],
  },
  Oread: {
    first: [
      'Agate','Basalt','Calcite','Dolomite','Earthen','Feldspar','Granite','Hematite',
      'Ironstone','Jasper','Kaolin','Loam','Marble','Novaculite','Obsidian','Pumice',
      'Quartz','Rhyolite','Slate','Talc','Umber','Vesuvian','Wollastonite','Xenolith',
      'Yield','Zircon','Andesite','Bedrock','Chalcedony','Druze',
    ],
    male: [
      'Basalt','Calcite','Dolomite','Earthen','Feldspar','Granite','Hematite','Ironstone','Kaolin',
      'Loam','Novaculite','Obsidian','Pumice','Quartz','Rhyolite','Slate','Talc','Umber','Vesuvian',
      'Xenolith','Yield','Zircon','Andesite','Bedrock','Druze','Ashstone','Boulder','Cragwell',
      'Dolomito','Elementus','Feldman','Granithor','Hardcore','Ironheart','Jasmyn','Klippen',
    ],
    female: [
      'Agate','Calcite','Dolomite','Feldspar','Granite','Hematite','Jasper','Loam','Marble',
      'Novaculite','Obsidian','Pumice','Quartz','Rhyolite','Slate','Talc','Vesuvian','Wollastonite',
      'Chalcedony','Agathe','Basalto','Calcina','Dolomina','Earthena','Felspa','Granita','Hemat',
      'Ironetta','Jasmine','Kaolina','Limeira','Marbe','Obsidiana','Pumicita','Quartzia','Silvesta',
    ],
    last: [
      'Boulderback','Clayfist','Deepstone','Earthblood','Faultline','Groundshaker',
      'Hillborn','Ironvein','Jadepeak','Karst','Landslide','Mountainborn',
      'Nickelvein','Oreblood','Peakwalker','Quarryheart','Ridgeback','Stoneblood',
      'Tectonix','Underhill',
    ],
  },
  Sylph: {
    first: [
      'Aera','Breezewyn','Cirrus','Drafta','Ether','Featherlight','Gustara','Haze',
      'Iridessa','Jetstream','Kyphira','Loftara','Mistral','Nimbus','Ozone','Pluvia',
      'Quill','Rafale','Stratus','Tempestia','Updraft','Ventara','Whisp','Xephyra',
      'Yonder','Zephyrine','Airwyn','Breatha','Cloudara','Downdraft',
    ],
    male: [
      'Breezewyn','Cirrus','Drafta','Ether','Featherlight','Gustara','Jetstream','Kyphira','Loftara',
      'Mistral','Nimbus','Ozone','Quill','Rafale','Stratus','Updraft','Ventara','Xephyra','Zephyrine',
      'Airwyn','Downdraft','Aerin','Boreas','Caelus','Draftus','Ethereal','Favonian','Gaius','Habitus',
      'Ionus','Jetrius','Kaelus','Luftus','Mistrius','Nimbulus','Pluvin','Rafaelus','Strator',
    ],
    female: [
      'Aera','Breezewyn','Cirrus','Drafta','Featherlight','Gustara','Haze','Iridessa','Jetstream',
      'Kyphira','Loftara','Mistral','Nimbus','Pluvia','Rafale','Stratus','Tempestia','Updraft','Ventara',
      'Whisp','Yonder','Breatha','Cloudara','Aeris','Breezella','Cirra','Draftina','Etherial','Feather',
      'Gusta','Hazemore','Iridette','Kaela','Lofta','Mist','Pluvia','Rafella','Strata','Tempia',
    ],
    last: [
      'Airborn','Breezecatcher','Cloudwalker','Draftweaver','Ethersong','Fogdancer',
      'Galewing','Hazeborn','Ionwind','Jetborne','Kiteflyer','Loftglide',
      'Mistweaver','Nimbusride','Opalwind','Prismgust','Skyborn','Tempestborn',
      'Updraftwalker','Windwhisper',
    ],
  },
  Undine: {
    first: [
      'Aquara','Brook','Cascada','Delta','Eddy','Fjorda','Glaciera','Harbor',
      'Inlet','Jetty','Kelp','Lagoon','Marina','Nautica','Oceana','Pearl',
      'Quahog','Ripple','Shallows','Tidal','Undula','Vortex','Wavecrest','Xystus',
      'Yacht','Zephyrsea','Abyssal','Brine','Coral','Deepwater',
    ],
    male: [
      'Brook','Delta','Eddy','Fjorda','Harbor','Inlet','Jetty','Lagoon','Nautica','Pearl','Quahog',
      'Ripple','Tidal','Vortex','Xystus','Yacht','Zephyrsea','Brine','Deepwater','Adrianus','Aquilo',
      'Brackus','Cascadius','Deltarus','Eddyus','Fjordian','Harborus','Inletius','Jettius','Kelpus',
      'Lagoonis','Marinous','Nauticulus','Oceanius','Pearlus','Quahogius','Thalassus','Undulatus',
    ],
    female: [
      'Aquara','Cascada','Fjorda','Glaciera','Kelp','Lagoon','Marina','Nautica','Oceana','Pearl',
      'Quahog','Shallows','Undula','Vortex','Wavecrest','Yacht','Zephyrsea','Abyssal','Coral',
      'Aquarella','Brookella','Cascara','Deltina','Eddyssa','Fjordessa','Glaçiera','Harbor','Inletia',
      'Jettina','Kelpina','Lagonia','Marinella','Nautica','Oceanella','Pearlina','Quahogella',
    ],
    last: [
      'Bluewater','Coralborn','Deepcurrent','Eddystone','Foamcrest','Gulfstream',
      'Harborlight','Icewater','Jettyborn','Kelpwarden','Lakesong','Moonwater',
      'Nereide','Oceansong','Pearlborn','Riptide','Saltblood','Tidalborn',
      'Underwake','Wavewalker',
    ],
  },
  Goblin: {
    first: [
      'Ack','Blig','Crik','Drub','Erk','Flig','Grik','Hik',
      'Ik','Jig','Kik','Lig','Mig','Nik','Ogg','Pik',
      'Quig','Rik','Skig','Tik','Ug','Vig','Wik','Xig',
      'Yik','Zug','Bigbrain','Burntfingers','Crunch','Drool',
    ],
    male: [
      'Ack','Blig','Crik','Drub','Erk','Flig','Grik','Hik','Ik','Jig','Kik','Lig','Mig','Nik',
      'Ogg','Pik','Quig','Rik','Skig','Tik','Ug','Vig','Wik','Yik','Zug','Bigbrain','Burntfingers',
      'Crunch','Drool','Brak','Crok','Grag','Krag','Nag','Rug','Slag','Trog','Wrag','Zug',
    ],
    female: [
      'Bligga','Crikka','Erka','Fligga','Grika','Jigga','Kika','Liga','Miga','Nika','Pika','Rigga',
      'Skiga','Tika','Viga','Wika','Xiga','Yiga','Zigga','Chigga','Drigga','Frika','Grika','Hika',
      'Lika','Rigga','Snika','Trika','Vrika','Wicka','Zrika','Agga','Bigga','Chegga','Digga',
    ],
    last: [
      'Boommaker','Cruncher','Dogslicer','Earcollector','Firebug','Gobblespit',
      'Horsechomper','Inkstain','Junker','Knifeear','Lickwound','Mudlicker',
      'Nosebiter','Ogreslave','Pugwampi','Ratrider','Shinbone','Trasheater',
      'Uglyfeet','Wormeater',
    ],
  },
  Kobold: {
    first: [
      'Aksik','Brak','Cekil','Drik','Ekka','Flik','Grik','Hrek',
      'Ikki','Jark','Krek','Lik','Mek','Nek','Orrik','Plik',
      'Qikk','Rikk','Skik','Trik','Ukk','Vikk','Wekk','Xikk',
      'Yekk','Zikk','Arktik','Brikk','Clikk','Drekk',
    ],
    male: [
      'Aksik','Brak','Cekil','Drik','Flik','Grik','Hrek','Ikki','Jark','Krek','Lik','Mek','Nek',
      'Orrik','Plik','Qikk','Rikk','Skik','Trik','Ukk','Vikk','Wekk','Xikk','Yekk','Zikk','Arktik',
      'Brikk','Clikk','Drekk','Brak','Cruk','Drak','Frik','Grok','Hik','Jik','Kik','Lik','Mik',
    ],
    female: [
      'Ekka','Lika','Meka','Nika','Pika','Rikka','Skika','Tika','Vikka','Weka','Xika','Yeka','Zika',
      'Brikka','Clikka','Drekka','Ekkica','Flikka','Grika','Hrekka','Ikkita','Jarka','Kreka','Likka',
      'Meka','Nekka','Plikka','Rikatta','Skikka','Trika','Vikka','Wekka','Xikka','Yekka','Zikka',
    ],
    last: [
      'Brightvein','Copperscale','Darkmine','Emberclaw','Firescale','Goldvein',
      'Hoardkeeper','Ironscale','Jadeclaw','Keentrap','Lavascale','Mineguard',
      'Nightdig','Orescale','Pitfall','Quartzvein','Rubyscale','Silverclaw',
      'Trapmaker','Tunnelscale',
    ],
  },
  Duergar: {
    first: [
      'Azgrim','Bolgrund','Cragdur','Duergin','Ebondur','Felgrim','Grondur','Helmgrund',
      'Irondur','Jargrim','Krondur','Lurgrim','Morgund','Nargrund','Orgrim','Purdur',
      'Quargrund','Rathgrim','Stondur','Turgrim','Urgond','Valgrim','Wargund','Xurgrim',
      'Yargund','Zurgrim','Ashgrund','Blackgrim','Cinderdur','Darkgrund',
    ],
    male: [
      'Azgrim','Bolgrund','Cragdur','Duergin','Ebondur','Felgrim','Grondur','Helmgrund','Irondur',
      'Jargrim','Krondur','Lurgrim','Morgund','Nargrund','Orgrim','Purdur','Quargrund','Rathgrim',
      'Stondur','Turgrim','Urgond','Valgrim','Wargund','Xurgrim','Yargund','Zurgrim','Ashgrund',
      'Blackgrim','Cinderdur','Darkgrund','Bragrim','Curdrim','Dargrim','Ergrim','Forgrim',
    ],
    female: [
      'Azgrima','Bolgrunda','Cragdura','Duerga','Ebondura','Felgrima','Grondura','Helmgrunda',
      'Irondura','Jargrima','Krondura','Lurgrima','Morgunda','Nargrunda','Orgrima','Purdura',
      'Quargrunda','Rathgrima','Stondura','Turgrima','Urgonda','Valgrima','Wargunda','Xurgrima',
      'Yargrunda','Zurgrima','Ashgrunda','Blackgrima','Cinderdura','Darkgrunda','Astra','Borna',
    ],
    last: [
      'Ashforge','Blackiron','Copperdark','Darkforge','Embersteel','Firevein',
      'Grimhammer','Hollowmine','Irondeep','Jadedark','Knellforge','Lavamine',
      'Murkvein','Nightforge','Onyxdark','Pitforge','Runedeep','Slavesteel',
      'Tartarforge','Underdark',
    ],
  },
  Svirfneblin: {
    first: [
      'Belwar','Callarduran','Dargin','Entemoch','Firble','Glimmer','Harbin','Ilde',
      'Jink','Kibble','Lurk','Murk','Nibble','Opaque','Pebble','Quartz',
      'Rumble','Shimmer','Tumble','Urk','Vibe','Whisper','Xerik','Yurk',
      'Zilch','Amber','Burrow','Crystal','Dimpot','Echo',
    ],
    male: [
      'Belwar','Callarduran','Dargin','Entemoch','Firble','Glimmer','Harbin','Jink','Kibble','Lurk',
      'Murk','Nibble','Opaque','Pebble','Quartz','Rumble','Shimmer','Tumble','Urk','Vibe','Whisper',
      'Xerik','Yurk','Zilch','Burrow','Dimpot','Echo','Ashbling','Brightening','Cav','Deeplight',
      'Emberblast','Fizzlebop','Granite','Hardrock','Irondigger','Jazzstone',
    ],
    female: [
      'Amber','Crystal','Ilde','Burrow','Dimpot','Echo','Amberina','Burrowessa','Crystala','Dimple',
      'Echoella','Firnya','Glimmera','Harbina','Idella','Jinketta','Kibblina','Lurka','Murka',
      'Nibbleina','Pebbla','Quartzella','Rumbella','Shimmera','Tumbla','Urketta','Vibella','Whispera',
      'Xera','Yurka','Zilcha','Astra','Bethel','Chime','Delia','Etherella','Fayella',
    ],
    last: [
      'Brightstone','Cavelight','Deepgem','Earthglow','Fungusfoot','Glimmerstone',
      'Hiddenpath','Ironcrystal','Jadequartz','Keenstone','Lightfinder','Mushroompick',
      'Nightgem','Opalheart','Pebbletoss','Quartzheart','Rockhide','Stonewhisper',
      'Tunnelgem','Underbright',
    ],
  },
  Wayang: {
    first: [
      'Bayu','Catra','Dewi','Eka','Farhan','Gading','Hadi','Indah',
      'Jaya','Kartika','Lestari','Megah','Nurul','Opal','Putri','Ratna',
      'Satya','Teguh','Utari','Vina','Wayan','Xenia','Yanti','Zara',
      'Adi','Bintang','Cahya','Dian','Endah','Fajar',
    ],
    male: [
      'Bayu','Eka','Farhan','Gading','Hadi','Jaya','Lestari','Megah','Nurul','Satya','Teguh',
      'Utari','Vina','Wayan','Xenia','Adi','Bintang','Cahya','Dian','Endah','Fajar','Gilar',
      'Habib','Ilyas','Juman','Kayan','Laskar','Malik','Nasir','Ongki','Prayit','Qanit','Raden',
    ],
    female: [
      'Catra','Dewi','Indah','Kartika','Opal','Putri','Ratna','Yanti','Zara','Cahya','Dian','Endah',
      'Farida','Gita','Hana','Iman','Jivita','Kayla','Laila','Mala','Nita','Orchida','Priya','Quirah',
      'Radiya','Sinta','Tina','Ura','Valeska','Wanda','Xenia','Yara','Zelina','Alisha','Bella',
    ],
    last: [
      'Blackshadow','Darktail','Eclipseborn','Fademark','Gloomweaver','Halflight',
      'Inkskin','Jadedark','Keendark','Lurkshadow','Moonless','Nightpainter',
      'Opaqueheart','Phantomstep','Quietshade','Rimeshadow','Silhouette','Twilightmark',
      'Umbraveil','Voidpainter',
    ],
  },
};


// ═══════════════════════════════════════════════════
//  TITLES, NICKNAMES & EPITHETS (~1500+)
// ═══════════════════════════════════════════════════

const TITLES = {
  universal: [
    // Personality / reputation
    'the Bold','the Brave','the Cunning','the Fierce','the Silent','the Swift',
    'the Wanderer','the Wise','the Wicked','the Just','the Merciless','the Vigilant',
    'the Relentless','the Unyielding','the Scarred','the Exiled','the Redeemed',
    'the Unbroken','the Forsaken','the Branded','the Hollow','the Burned',
    'the Grim','the Pale','the Red','the Black','the Gray','the White',
    'the Quiet','the Loud','the Cruel','the Kind','the Patient','the Reckless',
    'the Honest','the Deceiver','the Faithful','the Damned','the Cursed','the Blessed',
    'the Wrathful','the Serene','the Fearless','the Dreadful','the Noble','the Humble',
    'the Proud','the Fallen','the Rising','the Lost','the Found','the Forgotten',
    'the Remembered','the Nameless','the Faceless','the Masked','the Veiled','the Hooded',
    'the Cloaked','the Shrouded','the Hidden','the Revealed','the Chosen','the Rejected',
    'the Worthy','the Unworthy','the Tested','the Proven','the Doubted','the Trusted',
    'the Hated','the Beloved','the Envied','the Pitied','the Feared','the Respected',
    'the Mad','the Sane','the Wild','the Tame','the Free','the Bound',
    'the Hungry','the Sated','the Tired','the Restless','the Vengeful','the Forgiving',
    'the Stubborn','the Yielding','the Proud','the Meek','the Bitter','the Sweet',
    // Combat / skill epithets
    'Shadowbane','Demonslayer','Wyrmfoe','Kingsbane','Oathbreaker','Dawnbringer',
    'Nightwalker','Stormcaller','Bloodhound','Ironwill','Deadeye','Ghostwalker',
    'Hellraiser','Bonecollector','Gravewalker','Soulreaper','Plaguebringer','Doombringer',
    'Firestarter','Icebreaker','Thunderclap','Earthshaker','Windripper','Tidecaller',
    'Spellbreaker','Wardenbreaker','Chainbreaker','Wallbreaker','Gatekeeper','Pathfinder',
    'Trailblazer','Wayfinder','Seeker','Hunter','Stalker','Tracker','Ranger','Scout',
    'Sentinel','Guardian','Protector','Defender','Warden','Champion','Victor','Conqueror',
    'Slayer','Killer','Butcher','Executioner','Hangman','Judge','Arbiter','Inquisitor',
    'the Blade','the Shield','the Hammer','the Arrow','the Spear','the Axe',
    'the Sword','the Dagger','the Mace','the Flail','the Pike','the Lance',
    'the Bowstring','the Sharpened','the Tempered','the Hardened','the Forged','the Honed',
    // Animals / nature
    'the Wolf','the Bear','the Hawk','the Raven','the Serpent','the Spider',
    'the Lion','the Tiger','the Panther','the Eagle','the Owl','the Fox',
    'the Hound','the Stag','the Boar','the Bull','the Ram','the Shark',
    'the Viper','the Scorpion','the Crow','the Vulture','the Bat','the Rat',
    'the Weasel','the Badger','the Wolverine','the Lynx','the Falcon','the Drake',
    // Colors / elements
    'the Crimson','the Azure','the Golden','the Silver','the Iron','the Bronze',
    'the Copper','the Steel','the Obsidian','the Ivory','the Jade','the Ruby',
    'the Sapphire','the Emerald','the Amber','the Onyx','the Scarlet','the Violet',
    // Status / role
    'the Captain','the Commander','the General','the Marshal','the Admiral',
    'the Knight','the Squire','the Page','the Herald','the Messenger',
    'the Spy','the Thief','the Smuggler','the Pirate','the Privateer',
    'the Merchant','the Trader','the Broker','the Dealer','the Fence',
    'the Healer','the Mender','the Fixer','the Builder','the Maker',
    'the Breaker','the Destroyer','the Ravager','the Pillager','the Plunderer',
    'the Scholar','the Sage','the Seer','the Prophet','the Oracle',
    'the Priest','the Monk','the Hermit','the Ascetic','the Pilgrim',
    // Body / scars / appearance
    'One-Eye','One-Arm','One-Hand','No-Nose','Half-Ear','Split-Lip',
    'Three-Fingers','Nine-Toes','Crooked','Bent','Twisted','Hunched',
    'Tall','Short','Thin','Stout','Broad','Narrow','Long','Wide',
    'Scarback','Scarhand','Scarface','Burnmark','Branded','Tattoo',
    'Bald','Shaggy','Braids','Dreads','Topknot','Mohawk',
    'Redeye','Blackeye','Goldeye','Silvertooth','Goldtooth','Irontooth',
    'Longshanks','Shortleg','Bigfoot','Littlehand','Ironjaw','Glassjaw',
    // Behavioral / habit
    'the Drunk','the Sober','the Clean','the Filthy','the Loud','the Quiet',
    'the Early Riser','the Night Owl','the Sleeper','the Insomniac',
    'the Gambler','the Cheat','the Honest','the Liar','the Oath-Keeper',
    'the Promise-Breaker','the Debtor','the Collector','the Miser','the Generous',
    'the Laughing','the Weeping','the Smiling','the Frowning','the Grinning',
    'the Singing','the Humming','the Whistling','the Mumbling','the Shouting',
    // Location / origin
    'the Northerner','the Southerner','the Easterner','the Westerner',
    'the Islander','the Mainlander','the Highlander','the Lowlander',
    'the Desert-Born','the Forest-Born','the Mountain-Born','the Sea-Born',
    'the City-Born','the Village-Born','the Farm-Born','the Road-Born',
    'the River Rat','the Sea Dog','the Land Lubber','the Cliff Walker',
    'the Swamp Rat','the Sand Rat','the Snow Walker','the Mud Runner',
    'of the North','of the South','of the East','of the West',
    'of the Coast','of the Mountains','of the Plains','of the Wilds',
    'of the Undercity','of the Rooftops','of the Sewers','of the Docks',
    // Dramatic / mythic
    'the Twice-Dead','the Thrice-Cursed','the Seven-Scarred','the Hundred-Blooded',
    'the Deathless','the Lifebringer','the Worldender','the Realm-Walker',
    'the Oath-Forged','the Doom-Marked','the Fate-Touched','the Star-Crossed',
    'the Blood-Sworn','the Soul-Bound','the Heart-Broken','the Mind-Shattered',
    'the Storm-Born','the Fire-Forged','the Ice-Bound','the Earth-Sworn',
    'the God-Touched','the Devil-Marked','the Fey-Kissed','the Undead-Slayer',
    'the Dragon-Blooded','the Giant-Killer','the Troll-Hunter','the Witch-Finder',
    'the Plague-Survivor','the War-Orphan','the Last Survivor','the Sole Witness',
    'the Prophecy','the Omen','the Portent','the Harbinger',
    'the First','the Last','the Only','the Eternal','the Infinite',
  ],
  Human: [
    'the Conqueror','the Pretender','the Usurper','the Heir','the Bastard',
    'the Pilgrim','the Crusader','the Merchant Prince','the Sellsword',
    'the Outcast','the Returned','the Twice-Born','of the Iron Will',
    'the Kingslayer','the Crownless','the Penitent','the Anointed',
    'the Lawbringer','the Oathsworn','the Crownbearer','the Throneseeker',
    'the Landless','the Dispossessed','the Disinherited','the Reclaimed',
    'the Firstborn','the Lastborn','the Seventh Son','the Orphan',
    'the Foundling','the Changeling','the Adopted','the Disowned',
    'the Loyalist','the Rebel','the Revolutionary','the Traditionalist',
    'the Explorer','the Cartographer','the Navigator','the Pioneer',
    'the Diplomat','the Ambassador','the Envoy','the Negotiator',
    'the Warlord','the Tactician','the Strategist','the Fieldmarshal',
    'the Gladiator','the Duelist','the Fencer','the Brawler',
    'the Highborn','the Lowborn','the Commonborn','the Streetborn',
    'the Dockhand','the Sailor','the Deckswabber','the Bosun',
    'the Farmer','the Shepherd','the Miller','the Smith',
    'the Tanner','the Fletcher','the Cooper','the Mason',
    'the Beggar','the Urchin','the Cutpurse','the Pickpocket',
    'the Informant','the Whisperer','the Rumor','the Shadow',
    'of Absalom','of Cheliax','of Andoran','of Taldor','of Varisia',
    'of Osirion','of Qadira','of Brevoy','of Ustalav','of Lastwall',
    'the Chelish','the Taldan','the Keleshite','the Ulfen','the Varisian',
    'the Vudrani','the Garundi','the Mwangi','the Tian','the Shoanti',
    'Freebooter','Ironside','Gallowsgrace','Coinbiter','Mudfoot',
    'Saltblood','Ashwalker','Dustbringer','Rimecaller','Hearthguard',
    'Doomtide','Goldtongue','Silvertongue','Honeytongue','Sharptongue',
    'Deadman','Gravedigger','Corpseburner','Plaguedoctor','Bonepicker',
    'Ratcatcher','Snakeoil','Leechfinger','Nooseman','Gallowsbird',
    'Firewatcher','Nightcrier','Lampkeeper','Bellringer','Gatewatch',
    'the Branded','the Tattooed','the Painted','the Pierced','the Scarified',
    'of the Black Banner','of the Red Hand','of the White Tower',
    'of the Golden Company','of the Silver Shield','of the Iron Circle',
  ],
  Elf: [
    'of the Emerald Court','the Starborn','the Leafsinger','the Moonlit',
    'the Ancient','the Undying','the Feywild','the Dreamwalker','the Thornbound',
    'Starfall','Moonwhisper','Dawnseeker','the Ageless','the Spellsinger',
    'the Treesworn','the Windcaller','of the Silver Vale','the Evergreen',
    'the Bladesinger','the Lorewarden','the Sunspeaker','the Mist-Veiled',
    'the Dewborn','the Twilight','the Aurora','the Zenith','the Equinox',
    'the Solstice','the Eclipse','the Crescent','the Waning','the Waxing',
    'of the First Age','of the Last Forest','of the Dying Light','of the New Dawn',
    'the Rootbound','the Canopy Walker','the Branch Dancer','the Vine Speaker',
    'the Petal Guard','the Bloom Warden','the Seed Bearer','the Harvest Moon',
    'the Winter Court','the Summer Lord','the Spring Herald','the Autumn Sage',
    'the Sporewalker','the Fungal Sage','the Mossbeard','the Fernwhisper',
    'Starsight','Moongaze','Sunglance','Dawnwatcher','Dusklooker',
    'Spellweaver','Runereader','Glyphcarver','Wardkeeper','Mythkeeper',
    'Silversong','Goldenvoice','Crystalnote','Bellchime','Windflute',
    'Arrowsong','Bowdancer','Bladewhirl','Swordsinger','Spearleaf',
    'the Dreaming','the Awakened','the Slumbering','the Remembering',
    'the Forgetting','the Yearning','the Mourning','the Celebrating',
    'the Fading','the Brightening','the Shimmering','the Glowing',
    'of Kyonin','of Celwynvian','of the Fierani','of Iadara','of Sovyrian',
    'the Forlorn','the Returned','the Bleaching Survivor','the Brightness Keeper',
    'Leafshade','Thornmantle','Dewcatcher','Vinewalker','Briarborn',
    'Crystalbloom','Frostpetal','Flameleaf','Stormroot','Tidebranch',
    'the Eldest-Touched','the Fey-Kissed','the Green-Blooded','the Sap-Veined',
    'of the Singing Tree','of the Weeping Willow','of the Laughing Brook',
    'of the Whispering Glen','of the Dancing Glade','of the Moonlit Pool',
    'of the Starlit Path','of the Sunlit Clearing','of the Shadowed Grove',
  ],
  Dwarf: [
    'the Anvil','the Hammer','the Forge-Born','Ironbrow','Stonefist',
    'the Tunneler','the Deep Delver','the Beardless','the Grudgebearer',
    'Ale-Brother','the Unearthed','the Shieldwall','the Hearthkeeper',
    'of the Deep Roads','the Gem-Eye','Oathbound','the Unbreakable',
    'the Mountain','the Vault Keeper','Goldfinder','the Battlebeard',
    'the Runelord','the Axe','the Earthshaker',
    'Rockjaw','Ironteeth','Steelgrip','Coppertongue','Silverbeard',
    'Goldnose','Bronzeknuckle','Mithrilfist','Adamantine','Platinumheart',
    'the Deepborn','the Surfacer','the Skygazer','the Rootfinder',
    'the Veinseeker','the Lodefinder','the Prospector','the Assayer',
    'the Smelter','the Refiner','the Polisher','the Cutter','the Setter',
    'the Brewer','the Brewmaster','the Kegkeeper','the Barrelmaker',
    'the Tapmaster','the Alewright','the Meadmaker','the Vintner',
    'Foambeard','Hopsbreath','Barleyfist','Maltjaw','Yeastblood',
    'the Mason','the Architect','the Engineer','the Sapwright',
    'the Runecarver','the Glyphsmith','the Wardwright','the Sealmaker',
    'the Gatekeeper','the Wallbuilder','the Bridgemaker','the Roadlayer',
    'the Last Stand','the Rearguard','the Vanguard','the Flanker',
    'the Shieldbearer','the Standard','the Hornblower','the Drumbeater',
    'the Grudge Keeper','the Book of Grudges','the Oath Rememberer',
    'the Never-Forgetting','the Always-Remembering','the Score Settler',
    'of Janderhoff','of Kraggodan','of Highhelm','of Kovlar','of Taggoret',
    'the Darklands Walker','the Nar-Voth Delver','the Sekamina Explorer',
    'the Orcsmasher','the Giantslayer','the Trollbane','the Goblinbane',
    'Stoneblood','Ironlung','Steelgut','Coppervein','Granitebone',
    'the Immovable','the Rooted','the Steadfast','the Stalwart',
    'the Unshakeable','the Unbowed','the Unbent','the Unbroken',
    'the Bearded','the Braided','the Plaited','the Knotted',
    'the Shorn','the Cropped','the Bald','the Crestfallen',
    'the Miner','the Pickaxe','the Lantern','the Canary',
    'of the First Shaft','of the Deepest Vein','of the Motherload',
    'of the King Under the Mountain','of the High King','of the Low King',
  ],
  Halfling: [
    'the Lucky','the Quick','the Nimble','Lightfoot','the Unseen',
    'the Borrower','the Trickster','Quickfingers','the Merry','the Plucky',
    'the Fearless','the Pint-Sized','the Surprisingly Dangerous','Surefoot',
    'the Slippery','the Bold Little','the Road Runner','the Sneak',
    'the Jolly','Goodheart','Keeneye','the Daring',
    'the Overlooked','the Underestimated','the Underfoot','the Stepped-Over',
    'the Uncatchable','the Ungraspable','the Slippery','the Greased',
    'the Pocket-Sized','the Knee-High','the Shin-Kicker','the Ankle-Biter',
    'the Pantry Raider','the Cookie Thief','the Pie Bandit','the Cake Burglar',
    'the Second Breakfast','the Elevensies','the Luncheon','the Supper',
    'Stickyfingers','Lightpockets','Coinflip','Diceroller','Cardsharp',
    'the Gambler','the Cheat','the Hustler','the Swindler','the Con',
    'the Lookout','the Distraction','the Diversion','the Getaway',
    'the Rooftop','the Chimney','the Gutter','the Drainpipe',
    'the Mouse','the Squirrel','the Sparrow','the Cricket',
    'the Acorn','the Pebble','the Twig','the Leaf',
    'Hearthfinder','Innkeeper','Tavernfriend','Barprop','Fireside',
    'the Storyteller','the Song-Singer','the Tale-Teller','the Yarn-Spinner',
    'the Road-Worn','the Trail-Weary','the Path-Finder','the Way-Maker',
    'the Burrow-Born','the Hill-Raised','the Dale-Dweller','the Meadow-Child',
    'the Brave Little','the Stout Little','the Clever Little','the Wily Little',
    'the Unlikely Hero','the Accidental Champion','the Reluctant Adventurer',
    'the Homesick','the Wanderlust','the Restless Foot','the Itchy Heel',
    'Biscuit','Crumpet','Muffin','Scone','Crumble','Pudding',
    'Turnip','Parsnip','Butterbean','Honeycomb','Marmalade',
    'the Cook','the Baker','the Gardener','the Herbalist',
    'the Fiddler','the Piper','the Drummer','the Whistler',
  ],
  Gnome: [
    'the Peculiar','the Inventor','the Sparkle','the Tinkerer','Boom-Maker',
    'the Eccentric','the Brilliant','the Unhinged','the Whimsical','Geargrinder',
    'the Alchemical','Fizzbottom','the Wonder','the Chaotic','Sparkwhistle',
    'the Mad','the Colorful','the Explosive','the Visionary','the Prankster',
    'Wonderfizzle','the Improbable',
    'the Caffeinated','the Overcaffeinated','the Jittery','the Twitchy',
    'the Bouncy','the Springy','the Coiled','the Wound-Up',
    'Sparksocket','Gearloose','Cogwhirl','Sprocketjam','Pistonpop',
    'Valvesnap','Boilover','Steamwhistle','Pressurevent','Gasketblow',
    'the Experimenter','the Hypothesis','the Variable','the Constant',
    'the Theorem','the Proof','the Equation','the Solution',
    'the Prototype','the Beta','the Alpha','the Version Two',
    'the Kaboom','the Whoopsie','the Oops','the My-Bad',
    'the Fire-Starter','the Explosion-Adjacent','the Blast-Radius',
    'the Singed','the Smoking','the Charred','the Soot-Covered',
    'the Eyebrow-Less','the Hairless-Now','the Previously-Bearded',
    'the Paint-Splattered','the Ink-Stained','the Dye-Soaked',
    'the Color-Drunk','the Hue-Mad','the Shade-Touched','the Tint-Blessed',
    'the Bleaching-Defiant','the Wonder-Seeker','the Novelty-Hound',
    'the Curiosity','the Question','the Answer','the Riddle',
    'the Puzzle','the Enigma','the Conundrum','the Paradox',
    'Butterfingers','Thumbtack','Corkscrew','Bottlecap','Thimble',
    'the Clock-Watcher','the Time-Keeper','the Minute-Counter',
    'the Hour-Glass','the Sun-Dial','the Moon-Phase',
    'Boomstick','Sparkplug','Fizzpop','Cracklebang','Whizzbolt',
    'Zappledoo','Snaptrap','Clickwhirr','Buzzsaw','Ratchetclank',
    'the Magnificent','the Stupendous','the Incredible','the Unbelievable',
    'the Fantastical','the Miraculous','the Extraordinary','the Remarkable',
    'the Self-Proclaimed','the So-Called','the Alleged','the Supposed',
    'the Definitely-Not-Lying','the Totally-Trustworthy','the Honest-I-Swear',
  ],
  'Half-Elf': [
    'the Between','the Outcast','the Bridge','the Twice-Blooded','the Torn',
    'the Wandering','the Divided','the Unbound','the Half-Blooded','the Claimed',
    'the Nameless','the Belonging','of Two Worlds','the Rootless','the Chosen',
    'the Blended','Worldwalker','the Bridgeborn','the Dualblood','the Wayfinder',
    'the Neither','the Both','the Either','the Other','the In-Between',
    'the Twilight Child','the Dawn-Dusk','the Border Walker','the Threshold',
    'the Accepted','the Rejected','the Tolerated','the Welcomed',
    'the Proving','the Striving','the Becoming','the Arriving',
    'the Two-Tongued','the Bilingual','the Translator','the Interpreter',
    'the Mediator','the Go-Between','the Middleman','the Liaison',
    'the Mixed Blood','the Blended Line','the Merged House','the Joined Path',
    'the Adopted Elf','the Adopted Human','the Claimed by None','the Claimed by Both',
    'the Graceful','the Enduring','the Adaptable','the Versatile',
    'the Long-Lived','the Short-Lived','the In-Between Years','the Half-Century',
    'Duskblood','Dawnblood','Twilightborn','Starlit','Sunblessed',
    'Moonchild','Leafblood','Ironheart','Steelgrace','Silversoul',
    'the Elven-Raised','the Human-Raised','the Street-Raised','the Forest-Raised',
    'the Court-Trained','the Academy-Trained','the Self-Taught','the Mentor-Found',
    'of the Borderlands','of the Crossroads','of the Meeting Place',
    'of the Trade Road','of the River Crossing','of the Harbor',
    'the Peacemaker','the Unifier','the Harmonizer','the Balancer',
    'the Diplomat','the Ambassador','the Voice','the Ear',
    'the Forlorn','the Forsaken','the Abandoned','the Left-Behind',
    'the Survivor','the Perseverer','the Endurer','the Overcomer',
    'of Absalom','of Kyonin','of Andoran','of the Shackles','of Varisia',
  ],
  'Half-Orc': [
    'the Destroyer','the Savage','the Beast','the Undying','Skullcrusher',
    'the Bloodied','the Unbroken','the Defiant','the Raging','Bonegnawer',
    'the Feral','the Scarred One','the Pit Fighter','the Berserker','Trollbane',
    'the Unchained','Gorehowl','the Brute','the Undefeated','the War-Bred',
    'the Tusked','the Marauder','the Ravager','Beastblood',
    'the Unstoppable','the Immovable','the Inevitable','the Relentless',
    'the Tireless','the Sleepless','the Ceaseless','the Endless',
    'Skullbreaker','Bonecracker','Ribcrusher','Spinesnapper','Jawshatter',
    'Armripper','Legbreaker','Necktwister','Eyegouger','Earripper',
    'Nosebiter','Toothknocker','Kneecapper','Shincracker','Elbowsnap',
    'the Pit-Born','the Arena-Bred','the Ring-Tested','the Sand-Blooded',
    'the Cage-Fighter','the Chain-Breaker','the Shackle-Snapper',
    'the First Blood','the Last Standing','the Final Round','the Main Event',
    'the Crowd-Pleaser','the Showstopper','the Headliner','the Closer',
    'the War Drum','the Battle Cry','the Death Knell','the Last Roar',
    'the Waaagh','the Charge','the Stampede','the Avalanche',
    'Bloodfist','Ironjaw','Steelskull','Copperteeth','Brassknuckle',
    'the Greenskin','the Tuskborn','the Fangblood','the Clawhand',
    'the Rage-Born','the Fury-Fed','the Wrath-Child','the Anger-Seed',
    'the Civilized','the Educated','the Well-Spoken','the Eloquent',
    'the Surprising','the Unexpected','the Unconventional','the Exception',
    'the Gentle Giant','the Soft-Spoken','the Quiet Fury','the Calm Storm',
    'the Adopted','the Raised-Right','the City-Bred','the Town-Raised',
    'Gutpunch','Facestomp','Headbutt','Bodychecker','Clothesliner',
    'the Mountain','the Boulder','the Landslide','the Earthquake',
    'the Thunder','the Lightning','the Tempest','the Typhoon',
    'of Belkzen','of the Hold','of Urgir','of the Flood Truce',
    'the Half-Blood','the Green-Blooded','the Orcborn','the Manborn',
    'the Proving','the Challenger','the Contender','the Aspirant',
    'the Survivor','the Outlaster','the Endurer','the Persister',
    'Warchief','Warmaster','Warcaller','Warsinger','Wardancer',
    'the Horde','the Pack','the Swarm','the Legion',
  ],
};

// ── Standalone names (no surname, just a moniker) ──
const STANDALONE_NAMES = [
  'Skinner','Looty','Patches','Scarface','Knuckles','Stubs','Gimpy','Squint',
  'Rags','Stilts','Crutch','Peg','Hook','Nails','Tacks','Splinter',
  'Gutter','Sewer','Ditch','Puddle','Muddy','Dusty','Sandy','Smoky',
  'Crispy','Crunchy','Salty','Bitter','Sour','Sweet','Spicy','Bland',
  'Rusty','Crusty','Musty','Dusty','Frosty','Misty','Stormy','Breezy',
  'Lucky','Chance','Dice','Coin','Card','Trick','Bluff','Gambit',
  'Whisper','Murmur','Rumor','Echo','Shadow','Ghost','Specter','Phantom',
  'Blade','Edge','Point','Tip','Barb','Thorn','Spike','Needle',
  'Torch','Ember','Spark','Flame','Blaze','Inferno','Cinder','Ash',
  'Frost','Chill','Ice','Sleet','Hail','Snow','Flurry','Blizzard',
  'Thunder','Lightning','Storm','Tempest','Gale','Squall','Breeze','Zephyr',
  'Stone','Rock','Boulder','Pebble','Gravel','Flint','Slate','Granite',
  'Wolf','Bear','Hawk','Crow','Fox','Rat','Snake','Spider',
  'Oak','Elm','Pine','Birch','Thorn','Bramble','Nettle','Ivy',
  'the Cook','the Baker','the Brewer','the Smith','the Tanner','the Fletcher',
  'the Butcher','the Barber','the Carpenter','the Mason','the Cooper','the Chandler',
  'the Cobbler','the Tailor','the Weaver','the Dyer','the Fuller','the Potter',
  'the Captain','the Bosun','the Helmsman','the Navigator','the Lookout',
  'the Surgeon','the Sawbones','the Leech','the Apothecary','the Herbalist',
  'the Fence','the Fixer','the Broker','the Middleman','the Contact',
  'the Professor','the Teacher','the Tutor','the Mentor','the Student',
  'the Preacher','the Confessor','the Absolver','the Pardoner',
  'The Captain','The Surgeon','The Professor','The Collector','The Architect',
  'The Gentleman','The Lady','The Baron','The Countess','The Duke',
  'The Duchess','The Prince','The Princess','The King','The Queen',
  'The Cardinal','The Bishop','The Deacon','The Abbot','The Prior',
  'The Warden','The Jailer','The Hangman','The Executioner','The Judge',
  'The Inquisitor','The Arbiter','The Magistrate','The Chancellor',
  'The Alchemist','The Artificer','The Enchanter','The Conjurer',
  'The Diviner','The Illusionist','The Necromancer','The Transmuter',
  'The Wanderer','The Drifter','The Vagabond','The Nomad','The Traveler',
  'The Stranger','The Newcomer','The Outsider','The Foreigner',
  'The Old Man','The Old Woman','The Elder','The Ancient','The Crone',
  'The Kid','The Youth','The Youngster','The Runt','The Pup',
  'Fingers','Knots','Ropes','Chains','Shackles','Bolts','Nails','Rivets',
  'Copper','Silver','Gold','Iron','Tin','Lead','Mercury','Brass',
  'Boots','Buckles','Buttons','Patches','Stitches','Threads','Laces','Pins',
  'Flicker','Glimmer','Shimmer','Glint','Flash','Spark','Glow','Gleam',
  'Croak','Rasp','Growl','Snarl','Hiss','Purr','Chirp','Buzz',
];


// ═══════════════════════════════════════════════════
//  NAME GENERATION FUNCTIONS
// ═══════════════════════════════════════════════════

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/**
 * Get the name pool for a given race, optionally with ethnicity for humans.
 */
function getNamePool(race, ethnicity) {
  if (race === 'Human' && ethnicity && ETHNIC_NAMES[ethnicity]) {
    return ETHNIC_NAMES[ethnicity];
  }
  return RANDOM_NAMES[race] || RANDOM_NAMES.Human;
}

/**
 * Generate a random name for a character.
 * @param {string} race - Character race (Human, Elf, Dwarf, etc.)
 * @param {string} [ethnicity] - Human ethnicity (Chelaxian, Varisian, etc.)
 * @param {string} [gender] - Character gender (Male, Female, or null for neutral/any)
 * @returns {string} Generated name
 */
export function generateRandomName(race, ethnicity, gender) {
  // ~8% chance of standalone moniker
  if (Math.random() < 0.08) {
    return pick(STANDALONE_NAMES);
  }

  const pool = getNamePool(race, ethnicity);

  // Pick first name based on gender
  let first;
  if (gender === 'Male' && pool.male) {
    first = pick(pool.male);
  } else if (gender === 'Female' && pool.female) {
    first = pick(pool.female);
  } else {
    first = pick(pool.first);
  }

  // Resolve last names
  let lastNames = pool.last;
  if (!lastNames) {
    // Half-Elves: pick from Human or Elf
    lastNames = Math.random() > 0.5 ? RANDOM_NAMES.Human.last : RANDOM_NAMES.Elf.last;
  }
  const last = pick(lastNames);

  // Name format distribution:
  // ~12% first + title only ("Nanok the Blade")
  // ~20% full name + title ("Nanok Crushbone, the Blade")
  // ~10% first name only ("Losk")
  // ~58% normal first + last ("Nanok Crushbone")
  const roll = Math.random();

  if (roll < 0.12) {
    const raceTitles = TITLES[race] || TITLES.Human;
    const titlePool = Math.random() < 0.55 ? raceTitles : TITLES.universal;
    return `${first} ${pick(titlePool)}`;
  }

  if (roll < 0.32) {
    const raceTitles = TITLES[race] || TITLES.Human;
    const titlePool = Math.random() < 0.55 ? raceTitles : TITLES.universal;
    const title = pick(titlePool);
    const style = Math.random();
    if (style < 0.4) return `${first} "${title}" ${last}`;
    if (style < 0.75) return `${first} ${last}, ${title}`;
    return `${first} ${title} ${last}`;
  }

  if (roll < 0.42) {
    return first;
  }

  return `${first} ${last}`;
}

/**
 * Generate a name for an NPC, with optional role context for title bias.
 * @param {Object} opts
 * @param {string} [opts.race='Human'] - NPC race
 * @param {string} [opts.ethnicity] - Human ethnicity
 * @param {string} [opts.gender] - NPC gender (Male, Female, or null for neutral/any)
 * @param {string} [opts.role] - NPC role (merchant, guard, innkeeper, etc.) — increases title chance
 * @returns {string}
 */
export function generateNPCName({ race = 'Human', ethnicity, gender, role } = {}) {
  // NPCs with a role get a higher chance of a descriptive moniker
  if (role && Math.random() < 0.15) {
    return pick(STANDALONE_NAMES);
  }
  return generateRandomName(race, ethnicity, gender);
}

/**
 * Get a random ethnicity for human characters.
 * @returns {string}
 */
export function randomEthnicity() {
  return pick(ETHNICITIES);
}

export default { generateRandomName, generateNPCName, randomEthnicity, ETHNICITIES };
