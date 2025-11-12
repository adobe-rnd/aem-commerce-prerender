const PriceFragment = `fragment priceFields on ProductViewPrice {
  roles
  regular {
    amount {
      currency
      value
    }
  }
  final {
    amount {
      currency
      value
    }
  }
}`;

const ProductViewFragment = `fragment productViewFields on ProductView {
  __typename
  id
  sku
  name
  url
  description
  shortDescription
  metaDescription
  metaKeyword
  metaTitle
  urlKey
  inStock
  externalId
  lastModifiedAt
  images(roles: []) {
    url
    label
    roles
  }
  attributes(roles: ["visible_in_pdp"]) {
    name
    label
    value
    roles
  }
  ... on SimpleProductView {
    price {
      ...priceFields
    }
  }
  ... on ComplexProductView {
    options {
      id
      title
      required
      values {
        id
        title
        inStock
        ... on ProductViewOptionValueSwatch {
          type
          value
        }
        ... on ProductViewOptionValueProduct {
          product {
            sku
            name
            inStock
            images(roles: []) {
              url
              roles
            }
            attributes(roles: ["visible_in_pdp"]) {
              name
              label
              value
              roles
            }
            ... on SimpleProductView {
              price {
                roles
                regular {
                  amount {
                    value
                    currency
                  }
                }
                final {
                  amount {
                    value
                    currency
                  }
                }
              }
            }
          }
          quantity
          isDefault
        }
      }
    }
    priceRange {
      maximum {
        ...priceFields
      }
      minimum {
        ...priceFields
      }
    }
  }
}`;

const ProductQuery = `query ProductQuery($sku: String!) {
  products(skus: [$sku]) {
    ...productViewFields
  }
}
${ProductViewFragment}
${PriceFragment}`;

const ProductByUrlKeyQuery = `query ProductByUrlKey($urlKey: String!) {
  productSearch(
    current_page: 1
    filter: [{ attribute: "url_key", eq: $urlKey }]
    page_size: 1
    phrase: ""
  ) {
    items {
      productView {
        ...productViewFields
      }
    }
  }
}
${ProductViewFragment}
${PriceFragment}`;

const VariantsQuery = `query VariantsQuery($sku: String!) {
  variants(sku: $sku) {
    variants {
      selections
      product {
        sku
        name
        inStock
        images(roles: []) {
          url
          roles
        }
        attributes(roles: ["visible_in_pdp"]) {
          name
          label
          value
          roles
        }
        ... on SimpleProductView {
          price {
            roles
            regular {
              amount {
                value
                currency
              }
            }
            final {
              amount {
                value
                currency
              }
            }
          }
        }
      }
    }
  }
}`;

const GetLastModifiedQuery = `query getLastModified($skus: [String]!) {
  products(skus: $skus) {
    sku
    urlKey
    lastModifiedAt
  }
}`;

const GetUrlKeyQuery = `query getUrlKey($skus: [String]!) {
  products(skus: $skus) {
    sku
    urlKey
  }
}`;

const GetAllSkusPaginatedQuery = `query getAllSkusPaginated($currentPage: Int!) {
	productSearch(phrase: "", page_size: 500, current_page: $currentPage) {
		items {
        productView {
          urlKey
          sku
        }
    }
	}
}`;

const CategoriesQuery = `
  query getCategories {
      categories {
          name
          level
          urlPath
      }      
    }
`;

const ProductCountQuery = `
  query getProductCount($categoryPath: String!) {
    productSearch(
      phrase:"",
      filter: [ { attribute: "categoryPath", eq: $categoryPath } ],
      page_size: 1
    ) {
      page_info {
        total_pages
      }
    }
  }
`;

const ProductsQuery = `
  query getProducts($currentPage: Int, $categoryPath: String!) {
    productSearch(
      phrase: "",
      filter: [ { attribute: "categoryPath", eq: $categoryPath } ],
      page_size: 500,
      current_page: $currentPage,
      sort: {
        attribute: "name"
        direction: ASC
      }
    ) {
      items {
        productView {
          urlKey
          sku          
        }
      }
      page_info {
        current_page
        total_pages
      }
    }
  }
`;

module.exports = {
    ProductQuery,
    ProductByUrlKeyQuery,
    VariantsQuery,
    GetAllSkusPaginatedQuery,
    GetLastModifiedQuery,
    CategoriesQuery,
    ProductCountQuery,
    ProductsQuery,
    GetUrlKeyQuery
};