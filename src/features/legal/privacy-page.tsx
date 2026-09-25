import { m } from '~/paraglide/messages.js'
import { getLocale } from '~/paraglide/runtime.js'
import { COMPANY, ContactEmail, LegalLayout } from './legal-layout'

// Change the date with any change to the text below. The policy states what the app does, so
// a change to what it stores, where, or for how long updates it too.
const UPDATED = '2026-09-25'

export function PrivacyPage() {
  return (
    <LegalLayout title={m.legal_privacy_title()} updated={UPDATED}>
      {getLocale() === 'et' ? <PrivacyEt /> : <PrivacyEn />}
    </LegalLayout>
  )
}

function PrivacyEn() {
  return (
    <>
      <p>
        This policy explains what personal data Snowtime collects, why, and what you can do about
        it. Snowtime is a time tracker run by {COMPANY.name} at {COMPANY.site}.
      </p>

      <h2>Who we are</h2>
      <p>
        {COMPANY.name} (registry code {COMPANY.registryCode}), {COMPANY.address}, Estonia, is the
        controller of the personal data described here. For anything about this policy or your data,
        email <ContactEmail />.
      </p>
      <p>
        When an organization uses Snowtime for its members' work, the organization decides what its
        members record, and we process that data on its behalf. You can also ask the organization
        about its records. If your organization needs a data processing agreement with us, email us.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          Account: your name, email address, and profile picture link, which the sign-in provider
          (Google, GitHub, or Microsoft) sends us, and the provider's identifier for your account.
          We also keep the tokens the provider issues at sign-in; we don't use them to read anything
          else from your account.
        </li>
        <li>
          Passkeys: the public key and device details of each passkey you add. The private key never
          leaves your device.
        </li>
        <li>Sessions: for each signed-in device, its IP address, browser, and expiry time.</li>
        <li>Settings: your time zone, week start, language, and appearance choices.</li>
        <li>
          Organizations: the organizations, teams, and projects you belong to or create, your role
          in each, and invitations, including the invited person's email address.
        </li>
        <li>Time entries: the descriptions, projects, and start and stop times you record.</li>
        <li>
          Technical data: our hosting provider records requests, including IP addresses, in
          short-lived logs, and we count requests per IP address and account to limit abuse.
        </li>
      </ul>
      <p>We don't use analytics, advertising, or any tracking, and we don't sell personal data.</p>

      <h2>Why we use it</h2>
      <ul>
        <li>
          To provide Snowtime: signing you in, storing your entries, and showing reports to the
          people your organization allows. Legal basis: our contract with you (GDPR Article
          6(1)(b)).
        </li>
        <li>
          To keep the service secure and stop abuse, with sessions, rate limits, and logs. Legal
          basis: our legitimate interest in running a safe service (Article 6(1)(f)).
        </li>
        <li>
          To meet legal obligations, such as answering lawful requests from authorities (Article
          6(1)(c)).
        </li>
      </ul>

      <h2>Who can see your data</h2>
      <ul>
        <li>
          Members of your organizations see your name, email address, and profile picture. Who sees
          your time entries depends on roles: team leads see their teams' entries, and admins and
          owners see and can change every entry in the organization.
        </li>
        <li>
          Processors that run Snowtime for us under data processing terms:
          <ul>
            <li>Vercel hosts the application, which runs in Dublin, Ireland.</li>
            <li>Turso stores the database in Ireland.</li>
            <li>Upstash stores short-lived rate-limit counters in Ireland.</li>
          </ul>
        </li>
        <li>
          Sign-in providers: Google, GitHub, and Microsoft handle your sign-in under their own
          privacy policies. Your browser loads your profile picture from the provider's servers.
        </li>
        <li>Authorities, when the law requires it.</li>
      </ul>

      <h2>Transfers outside the EU</h2>
      <p>
        We store data in the EU, in Ireland. Vercel, Turso, and Upstash are US companies, so data
        may be accessed from the US, for example for support. These transfers rely on the European
        Commission's standard contractual clauses or an adequacy decision, such as the EU–US Data
        Privacy Framework.
      </p>

      <h2>How long we keep it</h2>
      <ul>
        <li>Account, settings, organizations, and entries: while your account exists.</li>
        <li>Sessions: until you sign out, or about a week after you last use them.</li>
        <li>
          Rate-limit counters: a few minutes. Logs: a short period set by the hosting provider.
        </li>
        <li>
          A deleted time entry or project disappears from the app at once but stays in the database
          marked as deleted, so the organization's history stays consistent. Email us if you need it
          erased.
        </li>
        <li>
          Backups: Turso keeps database backups for a limited time, after which deleted data is gone
          from them too.
        </li>
      </ul>

      <h2>Deleting your account</h2>
      <p>
        Snowtime has no delete button yet. Email <ContactEmail /> from your account's email address,
        and we'll delete the account within one month. We replace your name, email address, and
        picture, and remove your sessions, passkeys, and sign-in connections. Time entries you
        recorded in an organization stay in its records but no longer identify you. Before you ask,
        you can export your entries from Reports as CSV or XLSX.
      </p>

      <h2>Cookies and browser storage</h2>
      <p>We use only what the service needs to work, so we don't ask for consent:</p>
      <ul>
        <li>Sign-in cookies that keep you signed in.</li>
        <li>A language cookie that remembers your language for about a year.</li>
        <li>
          Browser storage that remembers, on this device, your appearance choices (theme, app icon,
          and scenery) and whether you've seen the intro.
        </li>
      </ul>

      <h2>Your rights</h2>
      <p>
        Under the GDPR, you can ask to access, correct, delete, restrict, or port your data, and
        object to processing based on our legitimate interest. Email <ContactEmail />; we reply
        within one month. You can change your name in Settings and export your entries from Reports
        yourself.
      </p>
      <p>
        You can complain to the Estonian Data Protection Inspectorate (Andmekaitse Inspektsioon,{' '}
        <a href="https://www.aki.ee/en">www.aki.ee</a>) or to the data protection authority in your
        country.
      </p>

      <h2>Children</h2>
      <p>Snowtime is a work tool and isn't meant for children under 13.</p>

      <h2>Changes</h2>
      <p>
        When our practices change, we update this page and its date. We announce significant changes
        in the app before they apply.
      </p>
    </>
  )
}

function PrivacyEt() {
  return (
    <>
      <p>
        See privaatsuspoliitika selgitab, milliseid isikuandmeid Snowtime kogub, mis eesmärgil ning
        millised on sinu õigused seoses oma andmetega. Snowtime on ajaarvestuse rakendus, mida pakub{' '}
        {COMPANY.name} aadressil {COMPANY.site}.
      </p>

      <h2>Kes me oleme</h2>
      <p>
        Siin kirjeldatud isikuandmete vastutav töötleja on {COMPANY.name} (registrikood{' '}
        {COMPANY.registryCode}), {COMPANY.address}, Eesti. Kõigi selle privaatsuspoliitika või oma
        andmetega seotud küsimuste korral kirjuta aadressile <ContactEmail />.
      </p>
      <p>
        Kui organisatsioon kasutab Snowtime'i oma liikmete töö arvestamiseks, otsustab
        organisatsioon, mida tema liikmed salvestavad, ja meie töötleme neid andmeid volitatud
        töötlejana tema nimel. Organisatsiooni andmete kohta saad lisainfot küsida otse vastavalt
        organisatsioonilt. Kui sinu organisatsioon vajab meiega andmetöötluslepingut (DPA), võta
        meiega ühendust.
      </p>

      <h2>Mida me kogume</h2>
      <ul>
        <li>
          Konto: sinu nimi, e-posti aadress ja profiilipildi link, mille sisselogimisteenus (Google,
          GitHub või Microsoft) meile saadab, ning teenusepakkuja unikaalne kasutajatunnus.
          Säilitame ka sisselogimisel väljastatud pääsutõendeid (tokens), kuid ei kasuta neid sinu
          kontolt muude andmete lugemiseks.
        </li>
        <li>
          Pääsuvõtmed: iga lisatud pääsuvõtme avalik võti ja seadme andmed. Privaatvõti ei lahku
          kunagi sinu seadmest.
        </li>
        <li>
          Seansid: iga sisselogitud seadme IP-aadress, veebilehitseja info ja seansi aegumisaeg.
        </li>
        <li>Seaded: ajavöönd, nädala alguspäev, keel ja kujunduseelistused.</li>
        <li>
          Organisatsioonid: organisatsioonid, tiimid ja projektid, kuhu kuulud või mille lood, sinu
          roll igas neist ning kutsed koos kutsutud isiku e-posti aadressiga.
        </li>
        <li>Ajakanded: salvestatud kirjeldused, projektid ning algus- ja lõpuajad.</li>
        <li>
          Tehnilised andmed: majutusteenuse pakkuja salvestab päringud koos IP-aadressidega
          lühiajalistesse logidesse ning loendame päringuid IP-aadressi ja konto lõikes, et teenuse
          kuritarvitamist tõkestada.
        </li>
      </ul>
      <p>
        Me ei kasuta analüütika-, reklaami- ega muid jälgimisteenuseid ning me ei müü isikuandmeid.
      </p>

      <h2>Milleks me andmeid kasutame</h2>
      <ul>
        <li>
          Snowtime'i pakkumiseks: sisselogimine, kannete salvestamine ja aruannete kuvamine
          isikutele, kellele sinu organisatsioon on selleks õiguse andnud. Õiguslik alus:
          meievaheline leping (isikuandmete kaitse üldmääruse / IKÜM artikli 6 lõike 1 punkt b).
        </li>
        <li>
          Teenuse turvalisuse tagamiseks ja kuritarvituste tõkestamiseks seansside,
          päringupiirangute ja logide abil. Õiguslik alus: meie õigustatud huvi pakkuda turvalist
          teenust (artikli 6 lõike 1 punkt f).
        </li>
        <li>
          Seadusest tulenevate kohustuste täitmiseks, näiteks ametiasutuste seaduslikele päringutele
          vastamiseks (artikli 6 lõike 1 punkt c).
        </li>
      </ul>

      <h2>Kes sinu andmeid näeb</h2>
      <ul>
        <li>
          Sinu organisatsioonide liikmed näevad sinu nime, e-posti aadressi ja profiilipilti.
          Ajakannete nägemine sõltub rollist: tiimijuhid näevad oma tiimide kandeid,
          administraatorid ja omanikud näevad ja saavad muuta kõiki organisatsiooni kandeid.
        </li>
        <li>
          Volitatud töötlejad, kes tagavad Snowtime'i tehnilise toimimise andmetöötlustingimuste
          alusel:
          <ul>
            <li>Vercel majutab rakendust, mille serverid asuvad Iirimaal Dublinis.</li>
            <li>Turso majutab andmebaasi Iirimaal.</li>
            <li>Upstash haldab lühiajalisi päringupiirangu loendureid Iirimaal.</li>
          </ul>
        </li>
        <li>
          Sisselogimisteenused: Google, GitHub ja Microsoft töötlevad sisselogimist oma
          privaatsuspoliitika alusel. Sinu brauser laadib profiilipildi vastava teenusepakkuja
          serveritest.
        </li>
        <li>Ametiasutused, kui seadus seda nõuab.</li>
      </ul>

      <h2>Andmete edastamine väljapoole EL-i</h2>
      <p>
        Hoiame andmeid Euroopa Liidus, Iirimaal. Vercel, Turso ja Upstash on USA ettevõtted, seega
        võidakse andmetele ligi pääseda ka USA-st, näiteks klienditoe või tehnilise toe osutamisel.
        Need edastused põhinevad Euroopa Komisjoni lepingu tüüptingimustel (standard contractual
        clauses) või kaitse piisavuse otsusel, näiteks ELi–USA andmekaitseraamistikul.
      </p>

      <h2>Kui kaua me andmeid hoiame</h2>
      <ul>
        <li>Konto, seaded, organisatsioonid ja kanded: kuni konto kustutamiseni.</li>
        <li>Seansid: kuni väljalogimiseni või ligikaudu nädal pärast viimast tegevust.</li>
        <li>
          Päringuloendurid: mõni minut. Logid: lühiajaliselt, vastavalt majutusteenuse pakkuja
          tingimustele.
        </li>
        <li>
          Kustutatud ajakanne või projekt kaob rakendusest kohe, kuid jääb andmebaasi kustutatuks
          märgituna, et organisatsiooni ajalugu püsiks terviklik. Kui vajad selle lõplikku
          kustutamist, kirjuta meile.
        </li>
        <li>
          Varukoopiad: Turso säilitab andmebaasi varukoopiaid piiratud aja, pärast mida kustuvad
          kustutatud andmed ka neist.
        </li>
      </ul>

      <h2>Konto kustutamine</h2>
      <p>
        Snowtime'is pole veel kustutamisnuppu. Kirjuta oma konto e-posti aadressilt aadressile{' '}
        <ContactEmail /> ja kustutame konto ühe kuu jooksul. Anonümiseerime või eemaldame sinu nime,
        e-posti aadressi ja profiilipildi ning kustutame seansid, pääsuvõtmed ja
        sisselogimisühendused. Organisatsioonis salvestatud ajakanded jäävad selle andmete hulka,
        kuid ei ole enam sinuga seostatavad. Enne konto sulgemist saad soovi korral oma kanded
        aruannete vaates CSV- või XLSX-failina alla laadida.
      </p>

      <h2>Küpsised ja brauseri salvestusruum</h2>
      <p>Kasutame ainult seda, mida teenus töötamiseks vajab, seega nõusolekut me ei küsi:</p>
      <ul>
        <li>sisselogimisküpsised, mis hoiavad sind sisselogituna;</li>
        <li>keeleküpsis, mis jätab sinu keele meelde umbes aastaks;</li>
        <li>
          brauseri kohalik salvestusruum (localStorage), mis jätab selles seadmes meelde
          kujunduseelistused (teema, rakenduse ikoon ja maastik) ning selle, kas oled tutvustust
          näinud.
        </li>
      </ul>

      <h2>Sinu õigused</h2>
      <p>
        Isikuandmete kaitse üldmääruse (IKÜM) alusel on sul õigus taotleda oma andmetega tutvumist,
        nende parandamist, kustutamist, töötlemise piiramist ja ülekandmist ning esitada
        vastuväiteid meie õigustatud huvil põhinevale töötlemisele. Kirjuta aadressile{' '}
        <ContactEmail />; vastame ühe kuu jooksul. Oma nime saad ise muuta seadetes ning kanded alla
        laadida aruannetest.
      </p>
      <p>
        Kaebuse esitamiseks on sul õigus pöörduda Andmekaitse Inspektsiooni (
        <a href="https://www.aki.ee">www.aki.ee</a>) või oma asukohariigi andmekaitseasutuse poole.
      </p>

      <h2>Lapsed</h2>
      <p>Snowtime on töövahend ega ole mõeldud alla 13-aastastele lastele.</p>

      <h2>Muudatused</h2>
      <p>
        Andmetöötluse põhimõtete muutumisel uuendame seda lehte ja selle kuupäeva. Olulistest
        muudatustest anname rakenduses teada enne nende jõustumist.
      </p>
    </>
  )
}
