import bcrypt from 'bcryptjs';
import { db, tx } from './db.js';
import { setSetting, getSetting } from './lib/settings.js';
import { nextApplicationNo } from './lib/members.js';

const SECTIONS = [
  {
    slug: 'about',
    kind: 'system',
    nav_label: 'परिचय',
    title: 'हमारे बारे में',
    subtitle: 'परिचय एवं इतिहास',
    image: '/img/about.jpg',
    layout: 'image-right',
    body: `<p>अवध की पावन धरती — अयोध्या, लखनऊ, सुल्तानपुर, प्रतापगढ़, रायबरेली, बाराबंकी, गोंडा एवं फ़ैज़ाबाद — से रोज़गार, व्यापार और शिक्षा के लिए पुणे आए राजपूत परिवारों ने अपनी जड़ों से जुड़े रहने के संकल्प के साथ <strong>अवध राजपूत विकास संघ</strong> की स्थापना की।</p>
<p>आज संघ पुणे एवं पिंपरी-चिंचवड के पाँच मंडलों में फैले सैकड़ों परिवारों का साझा मंच है। हम सामाजिक मेल-जोल, शिक्षा सहायता, युवाओं के मार्गदर्शन, महिलाओं के सशक्तिकरण और अपनी गौरवशाली राजपूत परंपराओं के संरक्षण के लिए निरंतर कार्य कर रहे हैं।</p>
<p>हमारा विश्वास है कि संगठित समाज ही सशक्त समाज है — इसलिए संघ हर सदस्य परिवार के सुख-दुःख में साथ खड़ा रहता है।</p>`,
  },
  {
    slug: 'president',
    kind: 'system',
    nav_label: 'अध्यक्ष संदेश',
    title: 'अध्यक्ष का संदेश',
    subtitle: 'ठाकुर रघुवीर सिंह — अध्यक्ष',
    image: '/img/avatar.svg',
    layout: 'image-left',
    body: `<p>प्रिय स्वजनों,</p>
<p>अवध की मिट्टी से निकलकर हम सब आज पुणे की कर्मभूमि में अपनी पहचान बना रहे हैं। समय के साथ आगे बढ़ते हुए भी अपनी संस्कृति, संस्कार और आपसी भाईचारे को जीवित रखना हम सबकी साझा ज़िम्मेदारी है।</p>
<p>संघ का प्रयास है कि समाज का कोई भी होनहार बच्चा आर्थिक कारणों से शिक्षा से वंचित न रहे, कोई भी परिवार संकट की घड़ी में स्वयं को अकेला न समझे। मैं सभी स्वजनों से आग्रह करता हूँ कि वे संघ से जुड़ें और समाज के उत्थान में सक्रिय सहभागी बनें।</p>
<p><strong>"यदि समाज का एक व्यक्ति आगे बढ़ता है, तो वह सौ लोगों को आगे बढ़ने की राह दिखाता है।"</strong></p>`,
  },
  {
    slug: 'vision-mission',
    kind: 'system',
    nav_label: 'दृष्टि एवं ध्येय',
    title: 'दृष्टि एवं ध्येय',
    subtitle: 'हमारे मूल सिद्धांत एवं दीर्घकालीन लक्ष्य',
    body: `<p>एक ऐसा संगठित, शिक्षित, स्वावलंबी और सम्मानित राजपूत समाज, जो अपनी गौरवशाली परंपराओं को संजोते हुए आधुनिक युग में हर क्षेत्र में अग्रणी हो।</p>
<ul><li>समाज के हर सदस्य में एकता, स्वाभिमान और आपसी सहयोग की भावना</li><li>आने वाली पीढ़ियों के लिए प्रगतिशील एवं संस्कारवान समाज</li></ul>`,
    body2: `<ul><li><strong>शैक्षणिक विकास:</strong> छात्रवृत्ति, कोचिंग सहायता एवं मेधावी छात्र सम्मान</li><li><strong>आर्थिक विकास:</strong> रोज़गार मार्गदर्शन, व्यापारिक नेटवर्क एवं स्वरोज़गार सहायता</li><li><strong>सामाजिक विकास:</strong> स्वास्थ्य शिविर, आपदा सहायता एवं वरिष्ठजन सेवा</li><li><strong>सांस्कृतिक संरक्षण:</strong> राजपूत परंपराओं, पर्वों एवं अवधी संस्कृति का संरक्षण</li></ul>`,
  },
  { slug: 'leadership', kind: 'block', nav_label: 'नेतृत्व', title: 'नेतृत्व एवं संस्थापक', subtitle: 'जिनके मार्गदर्शन में संघ आगे बढ़ रहा है' },
  { slug: 'trustees', kind: 'block', nav_label: 'ट्रस्टी', title: 'ट्रस्टी मंडल', subtitle: 'संस्था के शासन एवं विधिक दायित्वों के संरक्षक' },
  { slug: 'programs', kind: 'block', nav_label: 'कार्यक्रम', title: 'कार्यक्रम एवं उद्देश्य', subtitle: 'समाज के सर्वांगीण विकास हेतु हमारी पहल' },
  { slug: 'events', kind: 'block', nav_label: 'गतिविधियाँ', title: 'गतिविधियाँ एवं आयोजन', subtitle: 'आगामी कार्यक्रम एवं पिछली झलकियाँ' },
  { slug: 'directory', kind: 'block', nav_label: 'सदस्य सूची', title: 'सदस्य निर्देशिका', subtitle: 'प्रमुख, पदाधिकारी एवं सभी सदस्य — मंडल व समिति अनुसार' },
  { slug: 'wall', kind: 'block', nav_label: 'सामुदायिक मंच', title: 'सामुदायिक मंच', subtitle: 'घोषणाएँ, उपलब्धियाँ एवं समाज की चर्चाएँ' },
  { slug: 'join', kind: 'block', nav_label: 'सदस्य बनें', title: 'संघ से जुड़ें', subtitle: 'ऑनलाइन आवेदन करें और समाज के उत्थान में सहभागी बनें' },
  { slug: 'contact', kind: 'block', nav_label: 'संपर्क', title: 'संपर्क करें', subtitle: 'हमसे जुड़ने या जानकारी के लिए' },
];

const PEOPLE = [
  ['founder', 'स्व. ठाकुर रामपाल सिंह बैस', 'संस्थापक अध्यक्ष', 'प्रतापगढ़ / पुणे', 'संघ की नींव रखने वाले दूरदर्शी समाजसेवी, जिन्होंने पुणे में बसे अवध के राजपूत परिवारों को पहली बार एक मंच पर लाने का कार्य किया।'],
  ['founder', 'श्री ठाकुर जगदीश सिंह सोमवंशी', 'संस्थापक सदस्य', 'सुल्तानपुर / पुणे', 'शिक्षा सहायता कोष के प्रणेता; तीन दशकों से समाजसेवा में सक्रिय।'],
  ['founder', 'श्री बलवंत सिंह चौहान', 'संस्थापक महासचिव', 'रायबरेली / पुणे', 'संघ के संविधान एवं पंजीकरण में महत्वपूर्ण भूमिका निभाई।'],
  ['leader', 'ठाकुर रघुवीर सिंह', 'अध्यक्ष', 'हडपसर, पुणे', 'वरिष्ठ उद्यमी एवं समाजसेवी; संघ के वर्तमान अध्यक्ष।'],
  ['leader', 'श्री विजय प्रताप सिंह', 'उपाध्यक्ष', 'पिंपरी-चिंचवड', 'युवा मार्गदर्शन एवं रोज़गार प्रकोष्ठ का नेतृत्व।'],
  ['leader', 'श्री अजय सिंह बिसेन', 'सचिव', 'कोथरूड, पुणे', 'संघ के दैनिक प्रशासन एवं सदस्यता कार्य के प्रभारी।'],
  ['leader', 'श्री महेंद्र सिंह गौतम', 'कोषाध्यक्ष', 'वाकड, पुणे', 'संस्था के वित्तीय प्रबंधन एवं पारदर्शिता के उत्तरदायी।'],
  ['trustee', 'श्री रणविजय सिंह', 'मुख्य ट्रस्टी', 'पुणे', ''],
  ['trustee', 'श्री देवेंद्र सिंह बैस', 'ट्रस्टी', 'हडपसर', ''],
  ['trustee', 'श्रीमती सुमन सिंह', 'ट्रस्टी', 'कोथरूड', ''],
  ['trustee', 'श्री अरविंद सिंह सोमवंशी', 'ट्रस्टी', 'भोसरी', ''],
  ['trustee', 'श्री नरेंद्र सिंह गहरवार', 'ट्रस्टी', 'कात्रज', ''],
];

const PROGRAMS = [
  ['शिक्षा सहायता एवं छात्रवृत्ति', 'book-open', '/img/program-education.jpg', 'ज़रूरतमंद एवं मेधावी छात्र-छात्राओं को छात्रवृत्ति, पुस्तकें, कोचिंग सहायता तथा प्रतिवर्ष मेधावी छात्र सम्मान समारोह।'],
  ['सामाजिक कल्याण', 'heart', '/img/program-welfare.jpg', 'निःशुल्क स्वास्थ्य जाँच शिविर, रक्तदान शिविर, आपदा एवं चिकित्सा सहायता तथा वरिष्ठजनों की सेवा।'],
  ['सांस्कृतिक संरक्षण', 'flag', '/img/program-culture.jpg', 'महाराणा प्रताप जयंती, होली-दीपावली मिलन, तीज एवं अवधी लोक संस्कृति के आयोजनों द्वारा परंपराओं का संरक्षण।'],
  ['युवा सशक्तिकरण', 'users', '/img/program-youth.jpg', 'करियर मार्गदर्शन, नेतृत्व शिविर, खेलकूद प्रतियोगिताएँ, वृक्षारोपण एवं स्वयंसेवा के अवसर।'],
  ['महिला सशक्तिकरण', 'award', '', 'महिला प्रकोष्ठ के माध्यम से स्वरोज़गार प्रशिक्षण, स्वास्थ्य जागरूकता एवं सामाजिक भागीदारी।'],
  ['वैवाहिक परिचय सम्मेलन', 'star', '', 'समाज के युवक-युवतियों हेतु वार्षिक परिचय सम्मेलन एवं सादगीपूर्ण विवाह को प्रोत्साहन।'],
];

const EVENTS = [
  ['वार्षिक आम सभा 2026', '2026-12-13', 'सुबह 10:30 बजे', 'संघ भवन, हडपसर, पुणे', '/img/event-meeting.jpg', 'वर्ष भर की गतिविधियों की समीक्षा, आय-व्यय का ब्यौरा, नई कार्यकारिणी का गठन तथा आगामी वर्ष की योजनाओं पर चर्चा। सभी सदस्यों से उपस्थिति का आग्रह है।'],
  ['मकर संक्रांति स्नेह मिलन', '2027-01-14', 'दोपहर 4:00 बजे', 'कम्युनिटी हॉल, पिंपरी-चिंचवड', '/img/program-culture.jpg', 'तिल-गुड़, सांस्कृतिक कार्यक्रम एवं सहभोज के साथ समाज का पारिवारिक मिलन समारोह।'],
  ['निःशुल्क स्वास्थ्य जाँच एवं रक्तदान शिविर', '2026-08-15', 'सुबह 9:00 बजे', 'संघ भवन, हडपसर, पुणे', '/img/program-welfare.jpg', 'स्वतंत्रता दिवस के अवसर पर आयोजित शिविर में 250 से अधिक लोगों की स्वास्थ्य जाँच हुई तथा 68 यूनिट रक्तदान किया गया।'],
  ['मेधावी छात्र सम्मान समारोह', '2026-07-12', 'शाम 5:00 बजे', 'बालगंधर्व रंगमंदिर, पुणे', '/img/program-education.jpg', 'कक्षा 10वीं, 12वीं एवं स्नातक परीक्षाओं में उत्कृष्ट प्रदर्शन करने वाले 42 छात्र-छात्राओं को सम्मानित किया गया।'],
  ['महाराणा प्रताप जयंती समारोह', '2026-05-29', 'सुबह 8:00 बजे', 'महाराणा प्रताप उद्यान, पुणे', '/img/event-jayanti.jpg', 'वीर शिरोमणि महाराणा प्रताप की जयंती पर प्रतिमा माल्यार्पण, शोभा यात्रा एवं विचार गोष्ठी का आयोजन।'],
];

const MANDALS = [
  ['केंद्रीय मंडल', 'Central', 'पुणे शहर, स्वारगेट, शिवाजीनगर, कसबा पेठ'],
  ['उत्तर मंडल', 'North', 'पिंपरी-चिंचवड, भोसरी, चाकण, आकुर्डी'],
  ['दक्षिण मंडल', 'South', 'कात्रज, धनकवड़ी, सिंहगढ़ रोड, बिबवेवाड़ी'],
  ['पूर्व मंडल', 'East', 'हडपसर, खराडी, वाघोली, मुंढवा, विमान नगर'],
  ['पश्चिम मंडल', 'West', 'कोथरूड, वाकड, हिंजेवड़ी, बाणेर, औंध'],
];

const COMMITTEES = [
  ['कार्यकारिणी समिति', 'Executive Committee'],
  ['युवा प्रकोष्ठ', 'Youth Wing'],
  ['महिला प्रकोष्ठ', "Women's Wing"],
  ['सांस्कृतिक समिति', 'Cultural Affairs'],
  ['शिक्षा समिति', 'Education Committee'],
  ['सामाजिक कल्याण समिति', 'Social Welfare'],
];

// [category, designation, salutation, name, father, city, mandalIdx, committeeIdx, gotra, native, occupation]
const MEMBERS = [
  ['pramukh', 'अध्यक्ष', 'ठा.', 'रघुवीर सिंह', 'ठा. शिवबहादुर सिंह', 'हडपसर', 3, 0, 'बैस', 'प्रतापगढ़', 'उद्यमी'],
  ['pramukh', 'उपाध्यक्ष', 'श्री', 'विजय प्रताप सिंह', 'श्री रामनरेश सिंह', 'पिंपरी-चिंचवड', 1, 0, 'सोमवंशी', 'सुल्तानपुर', 'इंजीनियर'],
  ['pramukh', 'सचिव', 'श्री', 'अजय सिंह बिसेन', 'श्री कमला सिंह', 'कोथरूड', 4, 0, 'बिसेन', 'गोंडा', 'अधिवक्ता'],
  ['padadhikari', 'कोषाध्यक्ष', 'श्री', 'महेंद्र सिंह गौतम', 'श्री राजबहादुर सिंह', 'वाकड', 4, 0, 'गौतम', 'फ़ैज़ाबाद', 'चार्टर्ड अकाउंटेंट'],
  ['padadhikari', 'सह-सचिव', 'श्री', 'संजय सिंह चौहान', 'श्री हरिनाथ सिंह', 'शिवाजीनगर', 0, 0, 'चौहान', 'रायबरेली', 'व्यवसायी'],
  ['padadhikari', 'संगठन मंत्री', 'श्री', 'प्रदीप सिंह रघुवंशी', 'श्री जगत सिंह', 'कात्रज', 2, 0, 'रघुवंशी', 'अयोध्या', 'शिक्षक'],
  ['padadhikari', 'अध्यक्ष, युवा प्रकोष्ठ', 'श्री', 'अभिषेक सिंह', 'श्री दिनेश सिंह', 'खराडी', 3, 1, 'कलहंस', 'बाराबंकी', 'सॉफ़्टवेयर इंजीनियर'],
  ['padadhikari', 'अध्यक्षा, महिला प्रकोष्ठ', 'श्रीमती', 'सुनीता सिंह', 'श्री राकेश सिंह', 'बाणेर', 4, 2, 'बैस', 'लखनऊ', 'प्राध्यापिका'],
  ['padadhikari', 'संयोजक, सांस्कृतिक समिति', 'श्री', 'राहुल सिंह गहरवार', 'श्री उमाशंकर सिंह', 'भोसरी', 1, 3, 'गहरवार', 'प्रतापगढ़', 'व्यवसायी'],
  ['sadasya', '', 'श्री', 'राजेश सिंह', 'श्री रामकुमार सिंह', 'हडपसर', 3, 5, 'बैस', 'प्रतापगढ़', 'व्यवसायी'],
  ['sadasya', '', 'श्री', 'अनिल प्रताप सिंह', 'श्री जयकरन सिंह', 'वाघोली', 3, 1, 'सोमवंशी', 'सुल्तानपुर', 'सरकारी सेवा'],
  ['sadasya', '', 'श्रीमती', 'पूनम सिंह', 'श्री सुरेंद्र सिंह', 'औंध', 4, 2, 'चौहान', 'रायबरेली', 'गृहिणी'],
  ['sadasya', '', 'श्री', 'विकास सिंह', 'श्री ओमप्रकाश सिंह', 'चाकण', 1, 1, 'बिसेन', 'गोंडा', 'इंजीनियर'],
  ['sadasya', '', 'डॉ.', 'आलोक सिंह', 'श्री वीरेंद्र सिंह', 'स्वारगेट', 0, 4, 'गौतम', 'फ़ैज़ाबाद', 'चिकित्सक'],
  ['sadasya', '', 'कु.', 'प्रियंका सिंह', 'श्री अशोक सिंह', 'धनकवड़ी', 2, 4, 'रघुवंशी', 'अयोध्या', 'विद्यार्थी'],
  ['sadasya', '', 'श्री', 'मनोज सिंह', 'श्री बृजेश सिंह', 'हिंजेवड़ी', 4, 5, 'कलहंस', 'बाराबंकी', 'आईटी प्रोफ़ेशनल'],
  ['sadasya', '', 'श्री', 'सुरेश सिंह', 'श्री लालबहादुर सिंह', 'बिबवेवाड़ी', 2, 3, 'गहरवार', 'प्रतापगढ़', 'ठेकेदार'],
];

const PENDING = [
  ['श्री', 'नीरज सिंह', 'श्री रामबली सिंह', 'मुंढवा', 3, 1, 'बैस', 'प्रतापगढ़', 'व्यवसायी'],
  ['श्रीमती', 'कविता सिंह', 'श्री अमित सिंह', 'आकुर्डी', 1, 2, 'सोमवंशी', 'सुल्तानपुर', 'शिक्षिका'],
];

const POSTS = [
  ['announcement', 'वार्षिक आम सभा की सूचना', 'सभी सदस्यों को सूचित किया जाता है कि संघ की वार्षिक आम सभा रविवार, 13 दिसंबर 2026 को सुबह 10:30 बजे संघ भवन, हडपसर में आयोजित होगी। सभी सदस्य समय पर उपस्थित होकर अपने बहुमूल्य सुझाव दें।', '/img/event-meeting.jpg', 'संघ कार्यालय', 1],
  ['achievement', 'समाज की बेटी का चयन', 'हर्ष का विषय है कि समाज की बेटी कु. प्रियंका सिंह (धनकवड़ी) का चयन राज्य स्तरीय विज्ञान प्रतियोगिता के लिए हुआ है। संघ परिवार की ओर से हार्दिक बधाई एवं उज्ज्वल भविष्य की शुभकामनाएँ!', '', 'संघ कार्यालय', 0],
  ['event', 'स्वास्थ्य शिविर सफलतापूर्वक संपन्न', 'स्वतंत्रता दिवस पर आयोजित निःशुल्क स्वास्थ्य जाँच एवं रक्तदान शिविर में 250 से अधिक लोगों ने लाभ उठाया और 68 यूनिट रक्तदान हुआ। सभी स्वयंसेवकों एवं चिकित्सकों का आभार।', '/img/program-welfare.jpg', 'सामाजिक कल्याण समिति', 0],
  ['general', 'युवा प्रकोष्ठ की बैठक', 'युवा प्रकोष्ठ की अगली बैठक में करियर मार्गदर्शन कार्यशाला की रूपरेखा तय की जाएगी। इच्छुक युवा साथी अपना नाम प्रकोष्ठ अध्यक्ष को भेजें।', '', 'अभिषेक सिंह', 0],
];

function pickPhone(i) {
  return `9198${String(10000000 + i * 7919).slice(-8)}`;
}

function placeholders(n) {
  return Array.from({ length: n }, () => '?').join(',');
}

async function deleteIn(sql, values) {
  if (!values.length) return 0;
  return (await db.prepare(`${sql} (${placeholders(values.length)})`).run(...values)).changes || 0;
}

/** Remove the sample members / posts / events that shipped with the first deploy. Real rows you added are kept. */
async function removeDemoContent() {
  if (process.env.SEED_DEMO === 'true') return;
  if (await getSetting('demo_removed')) return;

  const phones = [...MEMBERS.map((_, i) => pickPhone(i + 1)), pickPhone(100), pickPhone(101)];
  const memberNames = [...MEMBERS.map((m) => m[3]), ...PENDING.map((p) => p[1])];
  const fatherNames = [...MEMBERS.map((m) => m[4]), ...PENDING.map((p) => p[2])];
  const personNames = PEOPLE.map((p) => p[1]);
  const programTitles = PROGRAMS.map((p) => p[0]);
  const eventTitles = EVENTS.map((e) => e[0]);
  const postTitles = POSTS.map((p) => p[1]);

  await tx(async () => {
    const members = await db.prepare('SELECT id, name, father_name, phone FROM members').all();
    const demoIds = members
      .filter(
        (m) =>
          phones.includes(m.phone) || (memberNames.includes(m.name) && fatherNames.includes(m.father_name))
      )
      .map((m) => m.id);

    if (demoIds.length) {
      await deleteIn('DELETE FROM donations WHERE member_id IN', demoIds);
      await deleteIn('DELETE FROM certificate_log WHERE member_id IN', demoIds);
      await deleteIn('DELETE FROM broadcast_recipients WHERE member_id IN', demoIds);
      await deleteIn("UPDATE posts SET member_id = NULL WHERE member_id IN", demoIds);
      await deleteIn('DELETE FROM members WHERE id IN', demoIds);
    }
    await deleteIn('DELETE FROM donations WHERE donor_name IN', memberNames);

    const posts = await db.prepare('SELECT id, title FROM posts').all();
    const postIds = posts.filter((p) => postTitles.includes(p.title)).map((p) => p.id);
    if (postIds.length) {
      await deleteIn('DELETE FROM comments WHERE post_id IN', postIds);
      await deleteIn('DELETE FROM post_likes WHERE post_id IN', postIds);
      await deleteIn('DELETE FROM posts WHERE id IN', postIds);
    }

    await deleteIn('DELETE FROM people WHERE name IN', personNames);
    await deleteIn('DELETE FROM programs WHERE title IN', programTitles);
    await deleteIn('DELETE FROM events WHERE title IN', eventTitles);

    const remaining = (await db.prepare('SELECT COUNT(*) AS n FROM members WHERE member_no IS NOT NULL').get()).n;
    await setSetting('member_counter', remaining);
    await setSetting('demo_removed', true);
  });
  console.log('[seed] नमूना सदस्य, दान, कार्यक्रम और पोस्ट हटाए गए।');
}

export async function seedIfEmpty() {
  const hasAdmin = (await db.prepare('SELECT COUNT(*) AS n FROM admins').get()).n > 0;
  if (!hasAdmin) {
    const username = process.env.ADMIN_USERNAME || 'admin';
    const password = process.env.ADMIN_PASSWORD || 'admin123';
    await db.prepare(
      "INSERT INTO admins (username, name, password_hash, role, must_change_password) VALUES (?, ?, ?, 'superadmin', ?)"
    ).run(username, 'मुख्य एडमिन', bcrypt.hashSync(password, 10), process.env.ADMIN_PASSWORD ? 0 : 1);
    console.log(`[seed] एडमिन बनाया गया: ${username} (पहले लॉगिन पर पासवर्ड बदलना आवश्यक है)`);
  }

  await removeDemoContent();

  if (await getSetting('seeded')) return;

  const seedDemo = process.env.SEED_DEMO === 'true';

  await tx(async () => {
    const insSection = db.prepare(`INSERT INTO sections
      (slug, kind, nav_label, title, subtitle, body, body2, image, layout, show_on_home, has_page, show_in_nav, visible, sort_order)
      VALUES (@slug, @kind, @nav_label, @title, @subtitle, @body, @body2, @image, @layout, 1, 0, 0, 1, @sort_order)
      ON CONFLICT (slug) DO NOTHING`);
    for (const [i, s] of SECTIONS.entries()) {
      await insSection.run({ body: null, body2: null, image: null, layout: 'image-right', ...s, sort_order: (i + 1) * 10 });
    }

    const insMandal = db.prepare('INSERT INTO mandals (name, name_en, description, sort_order) VALUES (?, ?, ?, ?)');
    const mandalIds = [];
    for (const [i, [n, en, d]] of MANDALS.entries()) mandalIds.push((await insMandal.run(n, en, d, i)).lastInsertRowid);
    const insCommittee = db.prepare('INSERT INTO committees (name, name_en, sort_order) VALUES (?, ?, ?)');
    const committeeIds = [];
    for (const [i, [n, en]] of COMMITTEES.entries()) committeeIds.push((await insCommittee.run(n, en, i)).lastInsertRowid);

    if (!seedDemo) {
      await setSetting('seeded', true);
      return;
    }

    const insPerson = db.prepare(
      'INSERT INTO people (grp, name, designation, place, bio, photo, sort_order) VALUES (?, ?, ?, ?, ?, NULL, ?)'
    );
    for (const [i, [grp, name, des, place, bio]] of PEOPLE.entries()) {
      await insPerson.run(grp, name, des, place, bio, i);
    }

    const insProgram = db.prepare('INSERT INTO programs (title, icon, image, summary, sort_order) VALUES (?, ?, ?, ?, ?)');
    for (const [i, [t, icon, img, sum]] of PROGRAMS.entries()) await insProgram.run(t, icon, img || null, sum, i);

    const insEvent = db.prepare(
      'INSERT INTO events (title, event_date, event_time, location, image, summary, body) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    for (const [t, d, time, loc, img, sum] of EVENTS) await insEvent.run(t, d, time, loc, img, sum, `<p>${sum}</p>`);

    const insMember = db.prepare(`INSERT INTO members
      (status, category, designation, salutation, name, father_name, gender, phone, whatsapp, city, district, state,
       mandal_id, committee_id, gotra, native_place, occupation, sort_order, member_no, approved_at)
      VALUES (@status, @category, @designation, @salutation, @name, @father_name, @gender, @phone, @phone, @city, 'पुणे', 'महाराष्ट्र',
       @mandal_id, @committee_id, @gotra, @native_place, @occupation, @sort_order, @member_no, @approved_at)`);
    const setAppNo = db.prepare('UPDATE members SET application_no = ? WHERE id = ?');

    for (const [i, [category, designation, sal, name, father, city, mi, ci, gotra, native, occ]] of MEMBERS.entries()) {
      const id = (
        await insMember.run({
          status: 'approved',
          category,
          designation: designation || null,
          salutation: sal,
          name,
          father_name: father,
          gender: ['श्रीमती', 'कु.', 'सुश्री'].includes(sal) ? 'महिला' : 'पुरुष',
          phone: pickPhone(i + 1),
          city,
          mandal_id: mandalIds[mi],
          committee_id: committeeIds[ci],
          gotra,
          native_place: native,
          occupation: occ,
          sort_order: i,
          member_no: `ARVS-${String(i + 1).padStart(4, '0')}`,
          approved_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
        })
      ).lastInsertRowid;
      await setAppNo.run(nextApplicationNo(id), id);
    }
    await setSetting('member_counter', MEMBERS.length);

    for (const [i, [sal, name, father, city, mi, ci, gotra, native, occ]] of PENDING.entries()) {
      const id = (
        await insMember.run({
          status: 'pending',
          category: 'sadasya',
          designation: null,
          salutation: sal,
          name,
          father_name: father,
          gender: sal === 'श्रीमती' ? 'महिला' : 'पुरुष',
          phone: pickPhone(100 + i),
          city,
          mandal_id: mandalIds[mi],
          committee_id: committeeIds[ci],
          gotra,
          native_place: native,
          occupation: occ,
          sort_order: 0,
          member_no: null,
          approved_at: null,
        })
      ).lastInsertRowid;
      await setAppNo.run(nextApplicationNo(id), id);
    }

    const insPost = db.prepare(
      "INSERT INTO posts (category, title, body, image, author_name, pinned, likes, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'published', NOW() + ($8::text)::interval)"
    );
    const insComment = db.prepare('INSERT INTO comments (post_id, name, body) VALUES (?, ?, ?)');
    for (const [i, [cat, title, body, img, author, pinned]] of POSTS.entries()) {
      const postId = (await insPost.run(cat, title, body, img || null, author, pinned, 12 - i * 3, `${-(i * 2 + 1)} days`)).lastInsertRowid;
      if (i === 1) {
        await insComment.run(postId, 'राजेश सिंह', 'बहुत-बहुत बधाई बिटिया को! समाज का नाम रोशन किया।');
        await insComment.run(postId, 'सुनीता सिंह', 'हार्दिक शुभकामनाएँ 🌸');
      }
    }

    await setSetting('seeded', true);
  });
  console.log(seedDemo ? '[seed] नमूना सामग्री जोड़ी गई।' : '[seed] खाली साइट तैयार है (नमूना सदस्य/दान नहीं जोड़े गए)।');
}
