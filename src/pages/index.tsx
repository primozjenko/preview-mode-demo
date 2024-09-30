import S3 from 'aws-sdk/clients/s3';
import { GetStaticProps } from 'next';
import Head from 'next/head';
import { useCallback, useRef, useState, useEffect } from 'react';
import Edit from '../components/edit';
import { ErrorDialog } from '../components/error';
import { ShareLinkDialog } from '../components/home/ShareLinkDialog';
import Malleable, { FieldEdit } from '../components/malleable';
import Snapshot from '../components/snapshot';
import { useScrollReset } from '../hooks/use-scroll-reset';
import layoutStyles from '../styles/layout.module.css';
import Image from 'next/image';
import { AutoScaling } from 'aws-sdk';

// Next.js automatically eliminates code used for `getStaticProps`!
// This code (and the `aws-sdk` import) will be absent from the final client-
// side JavaScript bundle(s).
const s3 = new S3({
  credentials: {
    accessKeyId: process.env.AWS_S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_S3_SECRET_ACCESS_KEY,
  },
});

export const getStaticProps: GetStaticProps = async ({
  // `preview` is a Boolean, specifying whether or not the application is in
  // "Preview Mode":
  preview,
  // `previewData` is only set when `preview` is `true`, and contains whatever
  // user-specific data was set in `res.setPreviewData`. See the API endpoint
  // that enters "Preview Mode" for more info (api/share/[snapshotId].tsx).
  previewData,
}) => {
  if (preview) {
    const { snapshotId } = previewData as { snapshotId: string };
    try {
      // In preview mode, we want to access the stored data from AWS S3.
      // Imagine using this to fetch draft CMS state, etc.
      const object = await s3
        .getObject({
          Bucket: process.env.AWS_S3_BUCKET,
          Key: `${snapshotId}.json`,
        })
        .promise();

      const contents = JSON.parse(object.Body.toString());
      return {
        props: { isPreview: true, snapshotId, contents },
      };
    } catch (e) {
      return {
        props: {
          isPreview: false,
          hasError: true,
          message:
            // 403 implies 404 in this case, as our IAM user has access to all
            // objects, but the bucket itself is private.
            e.statusCode === 403
              ? 'The requested preview edit does not exist!'
              : 'An error has occurred while connecting to S3. Please refresh the page to try again.',
        },
      };
    }
  }
  return { props: { isPreview: false } };
};

export default function Home(props) {
  // Scroll to top on mount as to ensure the user sees the "Preview Mode" bar
  useScrollReset();

  const [currentSnapshotId, setSnapshotId] = useState(null);
  const clearSnapshot = useCallback(() => setSnapshotId(null), [setSnapshotId]);

  const [isEdit, setEdit] = useState(false);
  const toggleEdit = useCallback(() => setEdit(!isEdit), [isEdit]);

  // Prevent duplication before re-render
  const hasSaveRequest = useRef(false);
  const [isSharingView, _setSharing] = useState(false);
  const setSharing = useCallback(
    (sharing: boolean) => {
      hasSaveRequest.current = sharing;
      _setSharing(sharing);
    },
    [hasSaveRequest, _setSharing]
  );

  const [currentError, setError] = useState<Error>(null);
  const onClearError = useCallback(() => {
    setError(null);
  }, [setError]);

  const share = useCallback(() => {
    if (hasSaveRequest.current) return;
    setSharing(true);

    const els = document.querySelectorAll('[id] > [contenteditable=true]');
    const persistContents: FieldEdit[] = [].slice
      .call(els)
      .map(({ parentNode: { id }, innerText }) => ({ id, innerText }));

    self
      .fetch(`/api/save`, {
        method: 'POST',
        body: JSON.stringify(persistContents),
        headers: { 'content-type': 'application/json' },
      })
      .then((res) => {
        if (res.ok) return res.json();
        return new Promise(async (_, reject) =>
          reject(new Error(await res.text()))
        );
      })
      .then(({ snapshotId }) => {
        setSnapshotId(snapshotId);
      })
      .catch((err) => {
        setError(err);
      })
      .finally(() => {
        setSharing(false);
      });
  }, []);

  const edits = props.isPreview ? props.contents : [];
  return (
    <>
      <Head>
        <title>Zrasti.si | Psihološko svetovanje</title>
        <meta
          name="description"
          content="Psihološko svetovanje vam pomaga razumeti in rešiti čustvene, vedenjske in duševne izzive. Naša storitev vam nudi osebno svetovanje za izboljšanje vašega duševnega zdravja in dobrega počutja."
        ></meta>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css" />


      </Head>
      {currentError && (
        <ErrorDialog onExit={onClearError}>
          <p>
            An error occurred while saving your snapshot. Please try again in a
            bit.
          </p>
          <pre>{currentError.message}</pre>
        </ErrorDialog>
      )}
      {currentSnapshotId && (
        <ShareLinkDialog
          snapshotId={currentSnapshotId}
          onExit={clearSnapshot}
        />
      )}
      <div className={layoutStyles.layout}>
        {(props.isPreview || props.hasError) && (
          <aside role="alert">
            <a href="/api/exit">Preview Mode</a>
          </aside>
        )}
        {props.hasError ? (
          <>
            <h1>Oops</h1>
            <h2>Something unique to your preview went wrong.</h2>
            <div className="explanation" style={{ textAlign: 'center' }}>
              <p>
                The production website is <strong>still available</strong> and
                this does not affect other users.
              </p>
            </div>
            <hr />
            <h2>Reason</h2>
            <div className="explanation" style={{ textAlign: 'center' }}>
              <p>{props.message}</p>
            </div>
          </>
        ) : (
          <Content isEdit={isEdit} edits={edits} />
        )}
      </div>
      {isEdit ? (
        <>
          <Snapshot
            onCancel={toggleEdit}
            onShare={share}
            isSharing={isSharingView}
          />
        </>
      ) : (
        <Edit onClick={toggleEdit} />
      )}
    </>
  );
}


function Content({ isEdit, edits }: { isEdit: boolean; edits: FieldEdit[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null); // Reference for the menu
  const hamburgerRef = useRef<HTMLDivElement>(null); // Reference for the hamburger icon

  const toggleMenu = () => {
    setIsOpen(!isOpen);
  };

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // Ignore clicks on the hamburger icon
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        hamburgerRef.current &&
        !hamburgerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false); // Close the menu if the click is outside
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    } else {
      document.removeEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  return (
    <div>


      <div className={layoutStyles.contentWrapper}>
        {/* Title */}
        <Malleable id="title" as="h1" isActive={isEdit} edits={edits} className={layoutStyles.title}>
          Zrasti.si
        </Malleable>

        {/* Hamburger Icon for mobile */}
        <div ref={hamburgerRef} className={layoutStyles.hamburger} onClick={toggleMenu}>
          ☰
        </div>

        {/* Menu with anchor links */}
        <nav ref={menuRef} className={`${layoutStyles.navbar} ${isOpen ? layoutStyles.showMenu : ''}`}>
          <a href="#psiholosko-svetovanje" onClick={toggleMenu}>🧠 Psihološko svetovanje</a>
          <a href="#kontakt" onClick={toggleMenu}>📞 Kontakt</a>
        </nav>

        {/* Image Section */}
        <section className={layoutStyles.heroSection}>
          <div className={layoutStyles.imageWrapper}>
            <Image
              className={layoutStyles.frontpageImg}
              src="/Untitled_design.png" // Path to your image
              alt="Psychological Counseling"
              width={1200}
              height={610}
              layout="responsive"
              priority={true}
              sizes="(max-width: 600px) 100vw, 1200px"
            />

            <div className={layoutStyles.textOverlay}>
              <p><b>Osvobodite se stresa, tesnobe, depresije</b> in omogočite pozitivne spremembe v vašem življenju!</p>
              <a href="#kontakt">
                <button className={layoutStyles.button}>Rezervirajte termin</button>
              </a>

            </div>
          </div>
        </section>
        <section className={layoutStyles.introductionSection}>
          <div className={layoutStyles.cardWrapper}>
            {/* Introduction Text */}
            <div className={layoutStyles.textContent}>
              <Malleable as="h2" className={layoutStyles.subtitle}>
                Dobrodošli!
              </Malleable>
              <p className={layoutStyles.paragraph}>
                Spletna stran <strong>Zrasti.si</strong> je tukaj za <strong>vas, vašo osebno rast in preobrazbo</strong>. Ne glede na to, s kakšnimi izzivi ali težavami se trenutno soočate, skupaj jih bomo premagali. Iz izkušenj sem se naučila, da je ključ do trajnih sprememb v življenju ravnovesje med osebno preobrazbo in praktičnim delom.
              </p>
              <div style={{ display: 'block' }}>
              <span className={layoutStyles.imageWrapper2} style={{ float: 'right', margin: '0 0 10px 10px' }}>
      <Image
        className={layoutStyles.frontpageImg}
        src="/fears.png"
        alt="source: https://www.flaticon.com/free-stickers/ability"
        width={140} // Adjust the width for mobile
        height={140}
      />
    </span>
  </div>
              <p className={layoutStyles.paragraph}>
                <strong>Zaslužite si svobodo in srečo</strong>, in tukaj sem, da vas podpiram in vodim na tej poti, korak za korakom. S pomočjo mojega znanja, tehnik in orodij vam bom pomagala <strong>odkriti, kdo v resnici ste in kakšen je vaš potencial v življenju</strong>.
              </p>
           

            </div>
          </div>
        </section>

        {/* Downloadable Resources */}
        <section id="brezplacne-vsebine">
          <div className={layoutStyles.downloadSection}>
            <Malleable as="h2" isActive={isEdit} edits={edits} className={layoutStyles.subtitle}>
              Brezplačne vsebine
            </Malleable>
            <p className={layoutStyles.paragraph}>
              Za vas sem pripravila delovne zvezke, ki jih lahko prenesete s klikom na spodnji gumb.
            </p>
            <a href="/Krepitev_obcutka_lastne_vrednosti.pdf" className={layoutStyles.downloadButton} download>
              Prenesi
            </a>
          </div>
        </section>


        {/* Psihološko svetovanje Section */}
        <section id="psiholosko-svetovanje" className={layoutStyles.psiholoskoSection}>
          <Malleable as="h2" isActive={isEdit} edits={edits} className={layoutStyles.subtitle}>
            Kaj je psihološko svetovanje?
          </Malleable>

          
          <p className={layoutStyles.paragraph}>
            Je oblika pogovorne terapije, kjer obravnavamo vaše <strong>aktualne psihične težave in stiske. </strong>
            Cilj je, da vam pomagam do <strong>bolj kakovostnega življenja</strong>, boljšega čustvovanja, vedenja, boljšega odnosa do sebe in drugih ter <strong>boljšega funkcioniranja</strong>. Psihološko svetovanje izvajamo psihologi, z ustreznim znanje za takšno delo.
           
            <div style={{ display: 'block' }}>
    
    <span className={layoutStyles.imageWrapper2} style={{ float: 'right', margin: '0 0 10px 10px' }}>
      <Image
        className={layoutStyles.frontpageImg}
        src="/brains.png"
        alt="source: https://www.flaticon.com/free-stickers/help"
        width={140} // Adjust the width for mobile
        height={140}
      />
    </span>
  </div>
            <p>
              Psihološko svetovanje je primerno za vas, če:
            </p>


            <ul>
              <li>se soočate z <strong>zmerno čustveno stisko</strong></li>
              <li>ste pod <strong>stresom</strong></li>
              <li>imate konkreten <strong>problem</strong>, za katerega sami niste našli zadovoljive rešitve</li>
              <li>želite izboljšati <strong>odnos do sebe in drugih</strong></li>
              <li>želite razumeti svoja <strong>čustva, vedenje in funkcioniranje</strong></li>
            </ul>
            <p className={layoutStyles.paragraph}>
              Včasih pa težave presegajo okvire psihološkega svetovanja, zato vas takrat usmerim v poglobljeno psihoterapevtsko obravnavo.
            </p>
          </p>
        </section>

        {/* Online psihološko svetovanje Section */}
        <section id="online-psiholosko-svetovanje" className={layoutStyles.psiholoskoSection}>
          <Malleable as="h2" isActive={isEdit} edits={edits} className={layoutStyles.subtitle}>
            Kaj pa je online psihološko svetovanje?
          </Malleable>
          

          <div style={{ display: 'block' }}>
          <span className={layoutStyles.imageWrapper2} style={{ float: 'right', margin: '0 0 10px 10px' }}>
      <Image
        className={layoutStyles.frontpageImg}
        src="/communication.png"
        alt="source: https://www.flaticon.com/free-stickers/online-meeting"
        width={140} // Adjust the width for mobile
        height={140}  
        />
    </span>
  </div>
          <p className={layoutStyles.paragraph}>
            Online psihološko svetovanje poteka enako kot običajno svetovanje, le da se izvaja preko videoklica ali telefonskega klica, glede na vaše želje.
            <p>Še nekaj let nazaj, pred začetkom pandemije, je bilo svetovanje in psihoterapija prek spleta precej tuj in nov koncept pri nas. Zaradi pandemije pa smo se bili prisiljeni navaditi na ta nov način delovanja sveta.</p>
            <p>In še dobro! Obstaja veliko razlogov, zakaj se je e-terapija tako razmahnila, in zakaj bo v prihodnje še bolj ustaljen in učinkovit način pomoči, npr.:</p>
            <h4>1. DOSTOPNOST</h4>
            <p>
              Ni se vam potrebno peljati nikamor in zapravljati dodatnega denarja za gorivo in parkirnine; priročna za gibalno ovirane osebe; priročno, če je vaše razpoloženje znižano in nimate motivacije za odhod iz hiše; dostopnost kvalitetne terapije ne glede na lokacijo, ne glede na to, ali živite v odročnemu kraju ali velikemu mestu, ali drugi državi.
            </p>
            <h4>2. ČAS</h4>
            <p>
              Prihranite veliko dragocenega časa, ker se izognete vožnji in gneči na cesti.
            </p>
            <h4>3. ZASEBNOST</h4>
            <p>
              Popolna diskretnost, saj vam ni potrebno skrbeti, da boste srečali znanca v čakalnici. Nekatere teme vam bo morda lažje odpreti in se o njih pogovoriti v okolju, kjer se vi počutite najbolj sproščene.
            </p>
            <h4>4. DOMAČE OKOLJE</h4>
            <p>
              Razkrivanje ranljivih delov sebe je težko. V poznanem, domačem okolju bo morda za vas ta proces znatno lažji. Pogovor o težjih temah je lahko lažji skozi ekran kot pa v živo. Morda boste najbolj sproščeni na vašem kavču v udobni trenirki s čajem in odejico 😊itd...
            </p>
          </p>

        </section>


{/* Online psihološko svetovanje Section */}
<section id="cas-za-spremembo" className={layoutStyles.psiholoskoSection}>
  <Malleable as="h2" isActive={isEdit} edits={edits} className={layoutStyles.subtitle}>
    ALI JE ČAS ZA SPREMEMBO?
  </Malleable>
  
  <div style={{ display: 'block' }}>
    <p className={layoutStyles.paragraph}>
      Zjutraj se zbudite in se pretvarjate, da so stvari 'v redu'. Pa niso. Do zdaj vam še nič ni zares pomagalo, da bi stvari spremenili na bolje.
    </p>
    
    <span className={layoutStyles.imageWrapper2} style={{ float: 'right', margin: '0 0 10px 10px' }}>
      <Image
        className={layoutStyles.frontpageImg}
        src="/mental-health.png"
        alt="source: https://www.flaticon.com/free-stickers/stress"
        width={140} // Adjust the width for mobile
        height={140}
      />
    </span>
  </div>



          <p className={layoutStyles.paragraph}>
            Zanima me, ali:

            <ul>
              <li>Se večkrat počutite nesrečne?</li>
              <li>Pogosto čutite strah, jezo, krivdo?</li>
              <li>Se počutite osamljene in izolirane?</li>
              <li>Ste pogosto napeti, zaskrbljeni, tesnobni?</li>
              <li>Ste pod stresom?</li>
              <li>Se vam zdi, da ste obstali na neki točki v življenju in ne znate naprej?</li>
              <li>Imate pomanjkanje motivacije?</li>
              <li>Je vaše razpoloženje znižano?</li>
              <li>Imate občutek, da ne veste, kdo v resnici ste, kaj si želite in česa ste sposobni?</li>
              <li>V vašem slovarju ne obstaja beseda NE, saj želite vsem ugajati?</li>
              <li>Vaše čustveno stanje vpliva na vsakodnevno funkcioniranje: zdravje, služba, medosebni odnosi…?</li>
              <li>Se samosabotirate?</li>
              <li>Si težko postavljate in dosegate cilje?</li>
              <li>Se težko soočate s spremembami v življenju?</li>
            </ul>

            <p>
              Ste se našli v enem ali več zgornjih vprašanj ali pa se domislili kakšnega podobnega? Odlično! In pohvale, da ste iskreni s sabo.
              Morda ste zdaj prvič opazili, da se pojavljajo težave na določenih področjih, morda pa ste že veliko časa namenili razmišljanju o tem, kaj v vašem življenju ne deluje.
              Prvi korak je vedno, da <strong>ozavestimo</strong> to, kar želimo spremeniti.
              <br />
              Tako, zdaj ste pripravljeni na naslednji korak: <strong>SPREMEMBO</strong>.
              <br />
              Tukaj sem jaz, da vas spremljam na poti preobrazbe. Moj cilj je, da vas opolnomočim, razbremenim čustvene stiske in da vam omogočim nove in močne "aha" trenutke.
            </p>
          </p>
          <div style={{ display: 'block' }}>
              <span className={layoutStyles.imageWrapper2} style={{ float: 'right', margin: '0 0 10px 10px' }}>
      <Image
        className={layoutStyles.frontpageImg}
        src="/brains2.png"
        alt="source: https://www.flaticon.com/free-stickers/ability"
        width={140} // Adjust the width for mobile
        height={140}
      />
    </span>
  </div>
        </section>
        {/* Po svetovanju Section */}
        <section id="cas-za-spremembo" className={layoutStyles.psiholoskoSection}>
          <Malleable as="h2" isActive={isEdit} edits={edits} className={layoutStyles.subtitle}>
            Po svetovanju
          </Malleable>
          <p className={layoutStyles.paragraph}>
            Po svetovanju boste lahko opazili:

            <ul>
              <li>da se zavedate lastne vrednosti, si znate prisluhniti in se postaviti na prvo mesto</li>
              <li>da si zaupate in vas mnenja drugih ne ganejo preveč</li>
              <li>da ste v stiku s sabo, veste, kaj si želite in kaj potrebujete, in to z lahkoto izražate</li>
              <li>da razvijete sočuten, nežen in potrpežljiv odnos do sebe, ki vam bo prinesel svobodo, boljšo samopodobo in močno samozavest</li>
              <li>da imate večji občutek moči, varnosti in stabilnosti ne glede na to, kaj se dogaja</li>
              <li>da imate jasno vizijo, kaj si v življenju želite in na kakšen način to doseči</li>
              <li>da vsakodnevne težave rešujete lažje in z manj napora</li>
              <li>da se lažje odločate</li>
              <li>da ste bolj zadovoljni, mirni, srečni</li>
            </ul>
          </p>
        </section>


        <hr></hr>

        {/* Kontakt Section */}
        <section id="kontakt">
          <Malleable as="h2" isActive={isEdit} edits={edits} className={layoutStyles.subtitle}>
            Kontakt
          </Malleable>
          <p className={layoutStyles.paragraph}>
            Za več informacij ali rezervacijo termina me lahko kontaktirate:
          </p>
          <span className={layoutStyles.paragraph}>📧 Email: </span>
          <span className={layoutStyles.paragraph}>
            <a href='mailto:zrasti.si@gmail.com'>zrasti.si@gmail.com</a>
          </span>
          <div></div>
          <span className={layoutStyles.paragraph}>📞 Telefon:
          </span>
          <span className={layoutStyles.paragraph}>
            <a href='tel:+386 70 646 775'> +386 70 646 775</a>
          </span>
        </section>



      </div>

      <section className={layoutStyles.footer}>
        <div className={layoutStyles.footerContent}>
          <p>
            © 2024, Zrasti.si
          </p>
          <p>
            <a href="mailto:zrasti.si@gmail.com">zrasti.si@gmail.com</a>
            <br />
            <a href="tel:+386 70 646 775">+386 70 646 775</a>
          </p>
        </div>

        <div className={layoutStyles.socialIcons}>
          <a href="https://www.facebook.com/zrasti.si" aria-label="Facebook" target="_blank" rel="noreferrer">
            <i className="fab fa-facebook-f"></i>
          </a>
          <a href="https://www.instagram.com/zrasti.si/" aria-label="Instagram" target="_blank" rel="noreferrer">
            <i className="fab fa-instagram"></i>
          </a>
        </div>
      </section>



    </div>

  );
}

