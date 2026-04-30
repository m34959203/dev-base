import {
  buildOrganizationJsonLd,
  buildWebsiteJsonLd,
  buildBreadcrumbsJsonLd,
  buildArticleJsonLd,
  type Breadcrumb,
  type ArticleForJsonLd,
} from "@/lib/seo";

type Props = { data: unknown; id?: string };

function JsonLdScript({ data, id }: Props) {
  return (
    <script
      id={id}
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}

export function OrganizationSchema() {
  return <JsonLdScript id="ld-org" data={buildOrganizationJsonLd()} />;
}

export function WebSiteSchema() {
  return <JsonLdScript id="ld-website" data={buildWebsiteJsonLd()} />;
}

export function BreadcrumbsSchema({ items }: { items: Breadcrumb[] }) {
  return <JsonLdScript id="ld-breadcrumbs" data={buildBreadcrumbsJsonLd(items)} />;
}

export function ArticleSchema({ article }: { article: ArticleForJsonLd }) {
  return <JsonLdScript id="ld-article" data={buildArticleJsonLd(article)} />;
}
