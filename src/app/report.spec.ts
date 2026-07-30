// `describe` and `it` here are the Jest/Jasmine globals.
// They have nothing to do with ReportService.describe above.
describe('ReportService', () => {
  it('works', () => {
    expect(1).toBe(1);
  });
});

describe('another suite', () => {
  it('also works', () => {
    expect(2).toBe(2);
  });
});
