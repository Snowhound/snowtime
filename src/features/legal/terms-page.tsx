import { Link } from '@tanstack/solid-router'
import { m } from '~/paraglide/messages.js'
import { getLocale } from '~/paraglide/runtime.js'
import { COMPANY, ContactEmail, LegalLayout } from './legal-layout'

// Change the date with any change to the text below.
const UPDATED = '2026-09-25'
const REPOSITORY = 'https://github.com/Snowhound/snowtime'

export function TermsPage() {
  return (
    <LegalLayout title={m.legal_terms_title()} updated={UPDATED}>
      {getLocale() === 'et' ? <TermsEt /> : <TermsEn />}
    </LegalLayout>
  )
}

function TermsEn() {
  return (
    <>
      <p>
        These terms apply when you use Snowtime at {COMPANY.site}, a time tracker run by{' '}
        {COMPANY.name} (registry code {COMPANY.registryCode}), {COMPANY.address}, Estonia. By
        signing in, you accept them. The <Link to="/privacy">privacy policy</Link> explains how we
        handle personal data.
      </p>

      <h2>The service</h2>
      <p>
        Snowtime is free. We may introduce paid plans or features later; we'll announce them in the
        app at least 30 days before they affect you, so you can decide whether to continue. We may
        also add, change, or remove features.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>
          You sign in with Google, GitHub, Microsoft, or a passkey. Keep those accounts and devices
          secure; you're responsible for what's done with your Snowtime account.
        </li>
        <li>You must be at least 13 years old.</li>
      </ul>

      <h2>Organizations</h2>
      <ul>
        <li>
          Whoever creates an organization becomes its owner. Owners and admins manage its members,
          teams, and projects, and can see and change all of its entries.
        </li>
        <li>
          If you set up Snowtime for an organization, such as your employer, you confirm that you're
          allowed to add its members and data. The organization is responsible for how it uses its
          members' time records, including telling its members about it.
        </li>
        <li>If you leave an organization, the entries you recorded there stay with it.</li>
      </ul>

      <h2>Your content</h2>
      <p>
        You keep all rights to what you enter. You let us store, process, and show it only to run
        Snowtime for you and your organizations. You can export your entries from Reports at any
        time.
      </p>

      <h2>Acceptable use</h2>
      <p>Don't:</p>
      <ul>
        <li>break the law or store content that infringes others' rights;</li>
        <li>
          try to access accounts or organizations you don't belong to, or test or break the
          service's security;
        </li>
        <li>overload the service, get around its limits, or automate it beyond normal use;</li>
        <li>use Snowtime to spam or harass others.</li>
      </ul>
      <p>
        We may suspend or close accounts and organizations that break these rules. We'll tell you
        why, unless the law or security prevents it.
      </p>

      <h2>Availability</h2>
      <p>
        We run Snowtime with care but without guaranteed uptime, and we may interrupt it for
        maintenance. We keep backups, but export data you can't afford to lose. If we decide to shut
        Snowtime down, we'll announce it in the app at least 30 days before, so you can export your
        data.
      </p>

      <h2>Ending your use</h2>
      <p>
        You can stop using Snowtime at any time and ask us to delete your account, as the{' '}
        <Link to="/privacy">privacy policy</Link> describes.
      </p>

      <h2>Open source</h2>
      <p>
        Snowtime's source code is public under the MIT License at{' '}
        <a href={REPOSITORY}>github.com/Snowhound/snowtime</a>. These terms cover the service at{' '}
        {COMPANY.site}; the license covers the code. If you run your own copy, you set the terms for
        its users.
      </p>

      <h2>Liability</h2>
      <p>
        Snowtime is provided as is, without warranties, as far as the law allows. We aren't liable
        for indirect losses, such as lost profits or lost data, and our total liability is limited
        to 100 euros. These limits don't apply where the law doesn't allow them, such as for harm
        caused intentionally or through gross negligence, or where they would take away your rights
        as a consumer.
      </p>

      <h2>Changes</h2>
      <p>
        We may update these terms. We announce significant changes in the app at least 30 days
        before they apply; if you keep using Snowtime after that, the new terms apply to you.
      </p>

      <h2>Law and disputes</h2>
      <p>
        Estonian law applies. Disputes go to Harju County Court in Tallinn, unless the law lets you
        as a consumer go to court where you live. As a consumer, you also keep the protection of
        your country's mandatory law.
      </p>

      <h2>Contact</h2>
      <p>
        Email <ContactEmail />.
      </p>
    </>
  )
}

function TermsEt() {
  return (
    <>
      <p>
        Need tingimused kehtivad, kui kasutad Snowtime'i aadressil {COMPANY.site}. Snowtime on
        ajaarvestuse rakendus, mida pakub {COMPANY.name} (registrikood {COMPANY.registryCode}),{' '}
        {COMPANY.address}, Eesti. Sisse logides nõustud nende tingimustega.{' '}
        <Link to="/privacy">Privaatsuspoliitika</Link> selgitab, kuidas me isikuandmeid käsitleme.
      </p>

      <h2>Teenus</h2>
      <p>
        Snowtime on tasuta. Võime hiljem lisada tasulisi pakette või funktsioone; anname neist
        rakenduses teada vähemalt 30 päeva enne, kui need sind puudutavad, et saaksid otsustada, kas
        jätkata. Võime ka funktsioone lisada, muuta või eemaldada.
      </p>

      <h2>Sinu konto</h2>
      <ul>
        <li>
          Logid sisse Google'i, GitHubi, Microsofti või pääsuvõtmega. Hoia neid kontosid ja seadmeid
          turvaliselt; vastutad selle eest, mida sinu Snowtime'i kontoga tehakse.
        </li>
        <li>Pead olema vähemalt 13-aastane.</li>
      </ul>

      <h2>Organisatsioonid</h2>
      <ul>
        <li>
          Organisatsiooni looja saab selle omanikuks. Omanikud ja administraatorid haldavad selle
          liikmeid, tiime ja projekte ning näevad ja saavad muuta kõiki selle kandeid.
        </li>
        <li>
          Kui seadistad Snowtime'i organisatsioonile, näiteks oma tööandjale, kinnitad, et sul on
          õigus lisada selle liikmeid ja andmeid. Organisatsioon vastutab selle eest, kuidas ta
          liikmete ajakandeid kasutab, sealhulgas liikmete teavitamise eest.
        </li>
        <li>Kui lahkud organisatsioonist, jäävad seal salvestatud kanded organisatsioonile.</li>
      </ul>

      <h2>Sinu sisu</h2>
      <p>
        Kõik õigused sisestatud sisule jäävad sulle. Lubad meil seda hoida, töödelda ja näidata
        üksnes selleks, et pakkuda Snowtime'i sulle ja sinu organisatsioonidele. Kandeid saad
        aruannete vaatest igal ajal alla laadida.
      </p>

      <h2>Lubatud kasutus</h2>
      <p>Ära:</p>
      <ul>
        <li>riku seadust ega hoia sisu, mis rikub teiste õigusi;</li>
        <li>
          püüa pääseda kontodele või organisatsioonidesse, kuhu sa ei kuulu, ega katsu läbi või
          murra teenuse turvalisust;
        </li>
        <li>
          koorma teenust üle, mööda selle piirangutest ega automatiseeri seda üle tavapärase
          kasutuse;
        </li>
        <li>kasuta Snowtime'i rämpsposti saatmiseks ega teiste ahistamiseks.</li>
      </ul>
      <p>
        Võime peatada või sulgeda kontod ja organisatsioonid, mis neid reegleid rikuvad. Anname
        põhjusest teada, kui seadus või turvalisus seda ei takista.
      </p>

      <h2>Kättesaadavus</h2>
      <p>
        Hoiame Snowtime'i hoolikalt töös, kuid ei garanteeri katkestusteta tööd ning võime selle
        hoolduseks peatada. Teeme varukoopiaid, kuid laadi alla andmed, mida ei tohi kaotada. Kui
        otsustame Snowtime'i sulgeda, anname sellest rakenduses teada vähemalt 30 päeva ette, et
        saaksid oma andmed alla laadida.
      </p>

      <h2>Kasutamise lõpetamine</h2>
      <p>
        Võid Snowtime'i kasutamise igal ajal lõpetada ja paluda oma konto kustutada, nagu{' '}
        <Link to="/privacy">privaatsuspoliitika</Link> kirjeldab.
      </p>

      <h2>Avatud lähtekood</h2>
      <p>
        Snowtime'i lähtekood on avalik MIT litsentsi alusel aadressil{' '}
        <a href={REPOSITORY}>github.com/Snowhound/snowtime</a>. Need tingimused kehtivad teenusele
        aadressil {COMPANY.site}, litsents aga koodile. Kui käitad oma koopiat, määrad selle
        kasutajatele tingimused ise.
      </p>

      <h2>Vastutus</h2>
      <p>
        Snowtime'i pakutakse sellisena, nagu see on, ilma garantiideta, niivõrd kui seadus seda
        lubab. Me ei vastuta kaudse kahju, näiteks saamata jäänud tulu või kaotatud andmete eest, ja
        meie vastutus on kokku piiratud 100 euroga. Need piirangud ei kehti, kui seadus neid ei
        luba, näiteks tahtlikult või raske hooletuse tõttu tekitatud kahju puhul või kui need
        võtaksid sinult tarbijana õigusi.
      </p>

      <h2>Muudatused</h2>
      <p>
        Võime neid tingimusi uuendada. Olulistest muudatustest anname rakenduses teada vähemalt 30
        päeva enne nende jõustumist; kui jätkad pärast seda Snowtime'i kasutamist, kehtivad sulle
        uued tingimused.
      </p>

      <h2>Õigus ja vaidlused</h2>
      <p>
        Snowtime'i kasutamisele kohaldatakse Eesti materiaalõigust. Vaidlused lahendab Harju
        Maakohus või sinu elukohajärgne kohus, kui seadus annab sulle tarbijana selle õiguse.
        Tarbijana säilib sulle ka sinu riigi kohustusliku õiguse kaitse.
      </p>

      <h2>Kontakt</h2>
      <p>
        Kirjuta aadressil <ContactEmail />.
      </p>
    </>
  )
}
