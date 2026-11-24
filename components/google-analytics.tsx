import Script from "next/script";

/**
 * Google Analytics 4 page tag. Renders nothing unless NEXT_PUBLIC_GA_MEASUREMENT_ID is set, so local
 * and preview builds without the variable send nothing.
 * The page's CSP nonce is passed through; 'strict-dynamic' then allows the scripts gtag loads.
 */
export function GoogleAnalytics({ nonce }: { nonce?: string }) {
  const id = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
  if (!id) return null;
  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${id}`} strategy="afterInteractive" nonce={nonce} />
      <Script id="ga4-init" strategy="afterInteractive" nonce={nonce}>
        {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${id}',{anonymize_ip:true});`}
      </Script>
    </>
  );
}
