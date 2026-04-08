import { useQuery } from "@tanstack/react-query";
import { Star, ShieldCheck, Globe, Home } from "lucide-react";
import { SiInstagram } from "react-icons/si";

/* ── Types ──────────────────────────────────────────────────────── */

type ReviewData = {
  google: { rating: number; count: number; url: string };
  yelp: { rating: number; count: number | null; url: string; badge?: string };
  houzz: {
    rating: number | null;
    count: number | null;
    url: string;
    badge?: string;
  };
};

type SalesRep = {
  name: string;
  title: string;
  email: string;
  phone: string;
};

/* ── Star rating renderer ───────────────────────────────────────── */

function Stars({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className="w-3.5 h-3.5"
          fill={i < Math.round(rating) ? "currentColor" : "none"}
          strokeWidth={i < Math.round(rating) ? 0 : 1.5}
        />
      ))}
    </div>
  );
}

/* ── Review badge card ──────────────────────────────────────────── */

function ReviewBadge({
  platform,
  rating,
  subtitle,
  url,
  color,
}: {
  platform: string;
  rating: number | null;
  subtitle: string;
  url: string;
  color: string;
}) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex-1 min-w-[160px] group"
      data-testid={`review-badge-${platform.toLowerCase()}`}
    >
      <div
        className="bg-white rounded-lg px-5 py-4 flex flex-col items-center text-center transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 border border-gray-100"
        style={{ "--badge-color": color } as React.CSSProperties}
      >
        <span
          className="text-sm font-bold tracking-wide mb-1.5"
          style={{ color }}
        >
          {platform}
        </span>
        {rating !== null ? (
          <>
            <span className="text-lg font-bold text-gray-900 leading-none mb-1">
              {rating.toFixed(1)}
            </span>
            <div style={{ color }} className="mb-1">
              <Stars rating={rating} />
            </div>
          </>
        ) : null}
        <span className="text-[11px] text-gray-500 leading-tight">
          {subtitle}
        </span>
      </div>
    </a>
  );
}

/* ── Credential card ────────────────────────────────────────────── */

function CredentialCard({
  href,
  icon,
  title,
  line1,
  line2,
  testId,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  line1: string;
  line2: string;
  testId: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex-1 min-w-[220px] group"
      data-testid={testId}
    >
      <div className="bg-white rounded-lg px-5 py-4 flex items-start gap-3.5 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 border border-gray-100">
        <div className="shrink-0 mt-0.5 text-[#2D2F2E]">{icon}</div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 leading-snug">
            {title}
          </p>
          <p className="text-xs text-gray-600 mt-0.5 leading-snug">{line1}</p>
          <p className="text-[11px] text-gray-400 mt-0.5 leading-snug">
            {line2}
          </p>
        </div>
      </div>
    </a>
  );
}

/* ── Social link pill ───────────────────────────────────────────── */

function SocialLink({
  href,
  icon,
  label,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 px-4 py-2 rounded-full bg-white border border-gray-100 text-gray-600 text-xs font-medium transition-all duration-200 hover:shadow-sm hover:text-gray-900 hover:border-gray-200"
      data-testid={`social-link-${label.toLowerCase()}`}
    >
      {icon}
      {label}
    </a>
  );
}

/* ── Main component ─────────────────────────────────────────────── */

export function TrustCredentials({ salesRep }: { salesRep?: SalesRep }) {
  const { data: reviews } = useQuery<ReviewData>({
    queryKey: ["/api/reviews"],
  });

  return (
    <section
      className="py-12 sm:py-16 px-4 sm:px-6"
      style={{ backgroundColor: "#F8F8F6" }}
      data-testid="trust-credentials-section"
    >
      <div className="max-w-2xl mx-auto">
        {/* Section heading */}
        <div className="text-center mb-8">
          <p
            className="text-xs uppercase tracking-[0.2em] text-gray-400 font-medium mb-2"
            style={{ fontFamily: "'General Sans', sans-serif" }}
          >
            Trust & Credentials
          </p>
          <h2
            className="text-lg sm:text-xl font-bold text-gray-900"
            style={{
              fontFamily: "'Cabinet Grotesk', 'General Sans', sans-serif",
            }}
          >
            Why Homeowners Choose Us
          </h2>
        </div>

        {/* Review badges row */}
        {reviews && (
          <div className="flex flex-col sm:flex-row gap-3 mb-6">
            <ReviewBadge
              platform="Google"
              rating={reviews.google.rating}
              subtitle={`${reviews.google.count}+ reviews`}
              url={reviews.google.url}
              color="#4285F4"
            />
            <ReviewBadge
              platform="Yelp"
              rating={reviews.yelp.rating}
              subtitle={reviews.yelp.badge || "Top rated"}
              url={reviews.yelp.url}
              color="#FF1A1A"
            />
            <ReviewBadge
              platform="Houzz"
              rating={reviews.houzz.rating}
              subtitle={reviews.houzz.badge || "Featured Pro"}
              url={reviews.houzz.url}
              color="#4DBC15"
            />
          </div>
        )}

        {/* Credentials row */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <CredentialCard
            href="/assets/cslb-license.jpg"
            icon={<ShieldCheck className="w-5 h-5" />}
            title="Licensed General Contractor"
            line1="CA License #1075129"
            line2="B - General Building Contractor"
            testId="credential-cslb"
          />
          <CredentialCard
            href="/assets/insurance-certificate.pdf"
            icon={<ShieldCheck className="w-5 h-5" />}
            title="Fully Insured"
            line1="General Liability & Workers Compensation"
            line2="Certificate available upon request"
            testId="credential-insurance"
          />
        </div>

        {/* Social links row */}
        <div className="flex flex-wrap justify-center gap-2.5 mb-8">
          <SocialLink
            href="https://www.1degreeconstruction.com"
            icon={<Globe className="w-3.5 h-3.5" />}
            label="Website"
          />
          <SocialLink
            href="https://instagram.com/1degreeconstruction"
            icon={<SiInstagram className="w-3.5 h-3.5" />}
            label="Instagram"
          />
          <SocialLink
            href="https://www.houzz.com/pro/1degreeconstruction"
            icon={<Home className="w-3.5 h-3.5" />}
            label="Houzz"
          />
        </div>

        {/* Portfolio CTA */}
        <div className="text-center">
          <p
            className="text-sm text-gray-500 leading-relaxed max-w-md mx-auto"
            style={{ fontFamily: "'Lora', Georgia, serif" }}
          >
            You can review our portfolio on our website and Instagram. If you
            have any questions, please do not hesitate to reach out.
          </p>
          {salesRep && (
            <div
              className="mt-4 text-xs text-gray-500 leading-relaxed"
              style={{ fontFamily: "'General Sans', sans-serif" }}
            >
              <p className="font-semibold text-gray-700">{salesRep.name}</p>
              <p>{salesRep.title}</p>
              <p>
                {salesRep.email} &middot; {salesRep.phone}
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
