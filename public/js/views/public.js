import { h, icon, esc, pct } from '../ui.js';
import { navigate } from '../router.js';
import { getState } from '../store.js';

const BRAND = `<span class="sidebar__mark" aria-hidden="true">R</span>`;

function publicNav() {
  const user = getState().user;
  const links = [
    { label: 'How it works', href: '#how' },
    { label: 'Pricing', href: '#/pricing' },
    { label: 'FAQ', href: '#faq' },
  ];
  return h('div', { class: 'public-nav' }, [
    h('a', { class: 'brand', href: '#/', html: `${BRAND}<span>Recall</span>` }),
    h('nav', {}, [
      ...links.map((l) => h('a', { class: 'btn btn--ghost', href: l.href, text: l.label })),
      user
        ? h('a', { class: 'btn btn--primary', href: '#/dashboard', text: 'Go to dashboard' })
        : h('a', { class: 'btn btn--ghost', href: '#/login', text: 'Sign in' }),
      user ? null : h('a', { class: 'btn btn--primary', href: '#/signup', text: 'Start studying free' }),
    ]),
  ]);
}

function publicFooter() {
  return h('footer', { class: 'footer' }, [
    h('div', { class: 'footer__inner' }, [
      h('div', { class: 'row', html: `${BRAND}<span class="strong">Recall</span><span class="muted">— study smarter, remember longer.</span>` }),
      h('nav', {}, [
        h('a', { href: '#/pricing', text: 'Pricing' }),
        h('a', { href: '#/privacy', text: 'Privacy' }),
        h('a', { href: '#/terms', text: 'Terms' }),
        h('a', { href: '#faq', text: 'FAQ' }),
        h('a', { href: 'mailto:support@recall.example', text: 'Support' }),
      ]),
    ]),
    h('div', { class: 'footer__inner mt-2' }, [
      h('span', { class: 'tiny muted', text: 'Recall is an independent study tool. It is not affiliated with or endorsed by any certification body. AI-generated study material can contain errors — always check against your official source material.' }),
    ]),
  ]);
}

export function renderLanding() {
  const step = (n, title, body) => h('div', { class: 'card card--pad-lg' }, [
    h('div', { class: 'row mb-1' }, [h('span', { class: 'step-num', text: String(n) }), h('h3', { class: 'mb-0', text: title })]),
    h('p', { class: 'mb-0', text: body }),
  ]);

  const faq = (q, a) => h('details', { class: 'faq' }, [h('summary', { text: q }), h('p', { text: a })]);

  return h('div', { class: 'public' }, [
    publicNav(),

    // Hero
    h('section', { class: 'hero' }, [
      h('div', {}, [
        h('div', { class: 'eyebrow', text: 'AI-powered certification study' }),
        h('h1', { text: 'Study smarter. Remember longer. Walk into your exam prepared.' }),
        h('p', { class: 'lead', text: 'Turn your notes and study materials into personalized flashcards, practice exams, and a study plan that adapts as you learn.' }),
        h('div', { class: 'hero-cta' }, [
          h('a', { class: 'btn btn--primary btn--lg', href: '#/signup', text: 'Start studying free' }),
          h('a', { class: 'btn btn--lg', href: '#how', text: 'See how it works' }),
        ]),
        h('p', { class: 'tiny muted mt-2', text: 'No credit card required. Free plan includes AI processing credits, flashcards and spaced repetition.' }),
      ]),
      // Dashboard preview (illustrative)
      h('div', { class: 'preview-frame' }, [
        h('div', { class: 'preview-frame__bar' }, [
          h('span', { class: 'preview-frame__dot' }), h('span', { class: 'preview-frame__dot' }), h('span', { class: 'preview-frame__dot' }),
          h('span', { class: 'tiny muted ml-auto', text: 'Illustrative preview — not your data' }),
        ]),
        h('div', { class: 'preview-frame__body' }, [
          h('div', { class: 'grid grid--3' }, [
            previewStat('Due today', '24', 'cards to review'),
            previewStat('Cards reviewed', '86', 'of 100 goal'),
            previewStat('Quiz accuracy', '78%', 'last 5 attempts'),
          ]),
          h('div', { class: 'card' }, [
            h('div', { class: 'row row--between mb-1' }, [h('span', { class: 'small strong', text: "Today's plan" }), h('span', { class: 'badge badge--accent', text: 'Adaptive' })]),
            h('div', { class: 'stack stack--sm' }, [
              previewTask('Review 24 due flashcards', '12 min'),
              previewTask('Practice weak topic: Subnetting', '15 min'),
              previewTask('Practice quiz — Network Security', '20 min'),
            ]),
          ]),
        ]),
      ]),
    ]),

    // How it works
    h('section', { class: 'section', id: 'how' }, [
      h('div', { class: 'eyebrow', text: 'How Recall works' }),
      h('h2', { text: 'Three steps from your notes to exam-ready' }),
      h('p', { class: 'lead', text: 'Recall turns the material you already have into a complete, personalized study system.' }),
      h('div', { class: 'grid grid--3 mt-2' }, [
        step(1, 'Upload your materials', 'Drag in PDFs, Word documents, slides or paste your notes. Recall extracts the text and identifies the concepts worth testing.'),
        step(2, 'Get flashcards & exams', 'Review the generated flashcards, multiple-choice, true/false and short-answer questions before saving them to your library.'),
        step(3, 'Study with spaced repetition', 'Recall schedules every card with FSRS, tracks your accuracy by topic, and rebuilds your plan as you improve.'),
      ]),
    ]),

    // Spaced repetition
    h('section', { class: 'section section--tight' }, [
      h('div', { class: 'grid grid--2' }, [
        h('div', {}, [
          h('div', { class: 'eyebrow', text: 'Spaced repetition' }),
          h('h2', { text: 'Review at the moment you are about to forget' }),
          h('p', { text: 'Recall schedules each card with FSRS, a modern spaced-repetition algorithm used by serious learners. Cards you find hard come back sooner; cards you know well are pushed further out.' }),
          h('ul', { class: 'price-list' }, [
            featureRow('Four-point rating on every card: Again, Hard, Good, Easy'),
            featureRow('Due Today queue built from your real review history'),
            featureRow('Difficulty and stability tracked per card, not per deck'),
            featureRow('Reviews cost nothing — no AI usage is spent while you study'),
          ]),
        ]),
        h('div', { class: 'card card--pad-lg' }, [
          h('h3', { text: 'What a review looks like' }),
          h('div', { class: 'stack stack--sm' }, [
            scheduleRow('Again', '1m', 'var(--danger)'),
            scheduleRow('Hard', '6m', 'var(--warning)'),
            scheduleRow('Good', '3d', 'var(--success)'),
            scheduleRow('Easy', '9d', 'var(--accent)'),
          ]),
          h('p', { class: 'tiny muted mt-2 mb-0', text: 'Example intervals for a new card. Real intervals adapt to your own recall history.' }),
        ]),
      ]),
    ]),

    // Practice exams & insights
    h('section', { class: 'section' }, [
      h('div', { class: 'grid grid--2' }, [
        h('div', { class: 'card card--pad-lg' }, [
          h('h3', { text: 'Practice exams and performance insights' }),
          h('p', { text: 'Build timed or untimed practice exams from your own material, with configurable question counts, topics and difficulty. After every attempt you get a topic-by-topic breakdown.' }),
          h('ul', { class: 'price-list' }, [
            featureRow('Timed exam mode with a live countdown'),
            featureRow('Explanations and common misconceptions'),
            featureRow('Retry missed questions, or turn them into flashcards'),
            featureRow('Improvement tracking across attempts'),
          ]),
          h('div', { class: 'alert alert--info mt-2' }, [
            h('span', { html: icon('alert', 16) }),
            h('span', { text: 'Recall generates practice questions from your material. They are not official exam questions and are clearly labelled as practice.' }),
          ]),
        ]),
        h('div', { class: 'card card--pad-lg' }, [
          h('h3', { text: 'Your dashboard, from your real activity' }),
          h('div', { class: 'stack stack--sm' }, [
            insightRow('Networking questions are your weakest area', '64% accuracy over 31 answers', 'warning'),
            insightRow('Accuracy is improving', 'up 12 points over your last 5 quizzes', 'success'),
            insightRow('24 cards are due for review', 'clear the queue before your next session', 'info'),
          ]),
          h('p', { class: 'tiny muted mt-2 mb-0', text: 'Insights only appear once there is enough data to support them.' }),
        ]),
      ]),
    ]),

    // Free vs Plus
    h('section', { class: 'section', id: 'pricing' }, [
      h('div', { class: 'eyebrow', text: 'Pricing' }),
      h('h2', { text: 'Start free. Upgrade when you are ready.' }),
      h('div', { class: 'grid grid--2 mt-2' }, [
        planCard(getState().plans?.free || DEFAULT_FREE, false),
        planCard(getState().plans?.plus || DEFAULT_PLUS, true),
      ]),
    ]),

    // FAQ
    h('section', { class: 'section', id: 'faq' }, [
      h('h2', { text: 'Frequently asked questions' }),
      faq('Does Recall guarantee I will pass my exam?', 'No. Recall is a study tool that helps you organize, review and practice. No study tool can promise an exam result, and any claim otherwise would be dishonest.'),
      faq('Are the practice questions official exam questions?', 'No. Questions are generated from the materials you upload, or built from your own flashcards. They are practice questions only and are clearly labelled as such.'),
      faq('Which certifications are supported?', 'Recall ships with a catalog covering IT and cybersecurity, healthcare, trades and technical, business and finance, and other certifications — plus a custom option. The catalog is data-driven, so new certifications can be added without rebuilding the app.'),
      faq('What happens to my uploaded documents?', 'Files are stored privately and are only accessible to your account. Text is sent to the AI provider only when you explicitly request generation. You can delete materials or your whole account at any time.'),
      faq('Can I use Recall without the AI features?', 'Yes. You can create study sets and flashcards manually and study with spaced repetition entirely without AI. AI is only used when you choose to generate content.'),
      faq('What happens if I cancel?', 'You keep Plus access until the end of the period you already paid for, then your account returns to the free plan. Your study data is not deleted.'),
    ]),

    // Final CTA
    h('section', { class: 'section section--tight' }, [
      h('div', { class: 'card card--pad-lg', style: 'text-align:center' }, [
        h('h2', { text: 'Your materials are already good enough. Make them work harder.' }),
        h('p', { text: 'Create a free account and turn your first document into a study system in minutes.' }),
        h('div', { class: 'hero-cta', style: 'justify-content:center' }, [
          h('a', { class: 'btn btn--primary btn--lg', href: '#/signup', text: 'Start studying free' }),
          h('a', { class: 'btn btn--lg', href: '#/login', text: 'I already have an account' }),
        ]),
      ]),
    ]),

    publicFooter(),
  ]);
}

const DEFAULT_FREE = { name: 'Free', priceMonthly: 0, features: ['1 certification workspace', 'Up to 5 study sets', '5 AI credits / month', 'Spaced repetition', '3 practice exams / month'] };
const DEFAULT_PLUS = { name: 'Recall Plus', priceMonthly: 12.99, priceAnnual: 103.92, features: ['10 workspaces', '250 study sets', '120 AI credits / month', 'Unlimited practice exams', 'Advanced analytics'] };

function previewStat(label, value, meta) {
  return h('div', { class: 'card' }, [
    h('div', { class: 'stat' }, [
      h('span', { class: 'stat__label', text: label }),
      h('span', { class: 'stat__value', text: value }),
      h('span', { class: 'stat__meta', text: meta }),
    ]),
  ]);
}
function previewTask(title, mins) {
  return h('div', { class: 'list-item' }, [
    h('span', { class: 'badge', text: mins }),
    h('span', { class: 'list-item__title', text: title }),
  ]);
}
function featureRow(text) {
  return h('li', {}, [h('span', { html: icon('check', 16) }), h('span', { text })]);
}
function scheduleRow(label, interval, color) {
  return h('div', { class: 'row row--between' }, [
    h('span', { class: 'badge', style: `color:${color}`, text: label }),
    h('span', { class: 'small strong', text: interval }),
  ]);
}
function insightRow(title, meta, kind) {
  return h('div', { class: `alert alert--${kind}` }, [
    h('div', {}, [h('div', { class: 'small strong', text: title }), h('div', { class: 'tiny', text: meta })]),
  ]);
}

export function planCard(plan, featured) {
  const annual = plan.priceAnnual;
  const monthly = plan.priceMonthly;
  const perMonth = plan.id === 'plus' || featured ? monthly : 0;
  return h('div', { class: `price-card ${featured ? 'price-card--featured' : ''}` }, [
    h('div', { class: 'row row--between' }, [
      h('h3', { class: 'mb-0', text: plan.name }),
      featured ? h('span', { class: 'badge badge--accent', text: 'Most popular' }) : null,
    ]),
    h('div', { class: 'mt-1' }, [
      h('span', { class: 'price-amount', text: perMonth ? `$${perMonth.toFixed(2)}` : '$0' }),
      h('span', { class: 'muted', text: perMonth ? ' / month' : ' forever' }),
    ]),
    annual ? h('p', { class: 'tiny muted mb-0', text: `or $${annual.toFixed(2)} per year (about $${(annual / 12).toFixed(2)}/month), billed annually` }) : h('p', { class: 'tiny muted mb-0', text: 'No credit card required' }),
    h('ul', { class: 'price-list' }, plan.features.map(featureRow)),
    h('div', { class: 'mt-3' }, [
      h('a', {
        class: `btn ${featured ? 'btn--primary' : ''} btn--block`,
        href: featured ? '#/pricing' : '#/signup',
        text: featured ? 'See plans' : 'Start free',
      }),
    ]),
  ]);
}

export function renderPricing() {
  const plans = getState().plans || { free: DEFAULT_FREE, plus: DEFAULT_PLUS };
  return h('div', { class: 'public' }, [
    publicNav(),
    h('section', { class: 'section' }, [
      h('div', { class: 'eyebrow', text: 'Pricing' }),
      h('h1', { text: 'Straightforward pricing for serious studying' }),
      h('p', { class: 'lead', text: 'The free plan is genuinely useful. Recall Plus adds a much larger AI allowance, more workspaces, unlimited practice exams and advanced analytics.' }),
      h('div', { class: 'grid grid--2 mt-2' }, [
        planCard(plans.free, false),
        planCard(plans.plus, true),
      ]),
      h('p', { class: 'small muted mt-3', text: 'All prices are in US dollars. Annual billing is charged once per year at checkout and renews automatically until cancelled. You can cancel at any time from your billing settings.' }),
    ]),
    publicFooter(),
  ]);
}

export function renderLegal(kind) {
  const isPrivacy = kind === 'privacy';
  const sections = isPrivacy ? [
    ['What we collect', 'Your account email and a securely hashed password, the study preferences you provide, the materials you upload, the study content generated from them, your review and quiz history, and basic billing status if you subscribe.'],
    ['How your data is used', 'Your data is used to run the product: generating study content, scheduling reviews, showing progress, and enforcing plan limits. We do not sell your data and we do not show advertising.'],
    ['AI processing', 'When you request generation, the extracted text of the selected material is sent to the configured AI provider to produce study content. Reviewing existing flashcards never calls the AI provider. You can disable AI features and still use manual flashcards and spaced repetition.'],
    ['Storage and access', 'Uploaded files are stored privately and served only through authenticated endpoints scoped to your account. Study data is isolated per user.'],
    ['Deletion and export', 'You can export all of your data as JSON and delete your account at any time from Settings. Deleting your account removes your study data, materials, flashcards, quiz history and review history.'],
    ['Contact', 'Questions about this policy can be sent to support@recall.example.'],
  ] : [
    ['Using Recall', 'Recall is a study aid. You are responsible for the accuracy of the material you upload and for verifying generated content against your official sources.'],
    ['No guarantee of results', 'Recall does not guarantee that you will pass any examination. Practice questions are generated from your material and are not official exam questions.'],
    ['Acceptable use', 'Do not upload content you do not have the right to use, and do not use the service to process unlawful material.'],
    ['Subscriptions', 'Paid plans renew automatically until cancelled. Cancelling stops future renewals and you retain access until the end of the period already paid for.'],
    ['Availability', 'The service is provided as-is. Features may change, and AI-generated content may contain errors.'],
    ['Contact', 'Questions about these terms can be sent to support@recall.example.'],
  ];
  return h('div', { class: 'public' }, [
    publicNav(),
    h('section', { class: 'section' }, [
      h('h1', { text: isPrivacy ? 'Privacy policy' : 'Terms of service' }),
      h('p', { class: 'lead', text: isPrivacy
        ? 'How Recall handles your account, your materials and your study data.'
        : 'The terms that apply when you use Recall.' }),
      h('div', { class: 'alert alert--warning' }, [
        h('span', { html: icon('alert', 16) }),
        h('span', { text: 'This is a plain-language document for a self-hosted deployment. Have it reviewed by qualified counsel before relying on it publicly.' }),
      ]),
      h('div', { class: 'mt-3' }, sections.map(([title, body]) => h('div', { class: 'card mb-2' }, [
        h('h3', { text: title }), h('p', { class: 'mb-0', text: body }),
      ]))),
    ]),
    publicFooter(),
  ]);
}

export { publicNav, publicFooter };
