export const pluralize = (value: number, singular: string, plural: string) => {
    return `${value} ${value === 1 ? singular : plural}`;
  };