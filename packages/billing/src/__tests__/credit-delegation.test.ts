import {
  clearMockedModules,
  mockModule,
} from '@codebuff/common/testing/mock-modules'
import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'

import {
  consumeCreditsWithDelegation,
  findOrganizationForRepository,
} from '../credit-delegation'

describe('Credit Delegation', () => {
  beforeAll(() => {
    // Mock the org-billing functions that credit-delegation depends on
    mockModule('@codebuff/billing/org-billing', () => ({
      normalizeRepositoryUrl: mock((url: string) => url.toLowerCase().trim()),
      extractOwnerAndRepo: mock((url: string) => {
        if (url.includes('codebuffai/codebuff')) {
          return { owner: 'codebuffai', repo: 'codebuff' }
        }
        return null
      }),
      consumeOrganizationCredits: mock(() => Promise.resolve()),
    }))

    // Mock common dependencies
    mockModule('@codebuff/common/db', () => ({
      default: {
        select: mock(() => ({
          from: mock(() => ({
            innerJoin: mock(
              () => ({
                // For findOrganizationForRepository -> userOrganizations
                where: mock(() =>
                  Promise.resolve([
                    {
                      orgId: 'org-123',
                      orgName: 'CodebuffAI',
                      orgSlug: 'codebuffai',
                    },
                  ]),
                ),
              }),
            ),
            where: mock(
              () =>
                // For findOrganizationForRepository -> orgRepos
                Promise.resolve([
                  {
                    repoUrl: 'https://github.com/codebuffai/codebuff',
                    repoName: 'codebuff',
                    isActive: true,
                  },
                ]),
            ),
          })),
        })),
      },
    }))

    mockModule('@codebuff/common/db/schema', () => ({
      orgMember: { org_id: 'org_id', user_id: 'user_id' },
      org: { id: 'id', name: 'name', slug: 'slug' },
      orgRepo: {
        org_id: 'org_id',
        repo_url: 'repo_url',
        repo_name: 'repo_name',
        is_active: 'is_active',
      },
    }))

    mockModule('@codebuff/common/util/logger', () => ({
      logger: {
        debug: mock(() => {}),
        info: mock(() => {}),
        error: mock(() => {}),
      },
    }))
  })

  afterAll(() => {
    clearMockedModules()
  })

  describe('findOrganizationForRepository', () => {
    it('should find organization for matching repository', async () => {
      const userId = 'user-123'
      const repositoryUrl = 'https://github.com/codebuffai/codebuff'

      const result = await findOrganizationForRepository(userId, repositoryUrl)

      expect(result.found).toBe(true)
      expect(result.organizationId).toBe('org-123')
      expect(result.organizationName).toBe('CodebuffAI')
    })

    it('should return not found for non-matching repository', async () => {
      const userId = 'user-123'
      const repositoryUrl = 'https://github.com/other/repo'

      const result = await findOrganizationForRepository(userId, repositoryUrl)

      expect(result.found).toBe(false)
    })
  })

  describe('consumeCreditsWithDelegation', () => {
    it('should fail when no repository URL provided', async () => {
      const userId = 'user-123'
      const repositoryUrl = null
      const creditsToConsume = 100

      const result = await consumeCreditsWithDelegation(
        userId,
        repositoryUrl,
        creditsToConsume,
      )

      expect(result.success).toBe(false)
      expect(result.error).toBe('No repository URL provided')
    })
  })
})
