import WPAPI from 'wpapi'
import { NodeType, parse, HTMLElement, Node, TextNode } from 'node-html-parser'
import { promisify } from 'util'
import { readFile, readdir } from 'fs'
import { DateTime } from "luxon"
import { join } from 'path'
import * as dotenv from 'dotenv'
import { chunk } from 'lodash'

const parallelism_post = 3
const parallelism_media = 3

const envs = dotenv.config().parsed as { 
    WP_USER: string, 
    WP_PASS: string,
    WP_URL: string,
    IDO_EXPORT_NAME: string, 
    IDO_BASE_URL: string
}

const cwd = __dirname
const template = { 
    slug: '',
    tags: [] as string[],
    categories: [] as string[],
    title: '', 
    content: '', 
    meta: {
        ingress: '', 
        updated: '',
        page_title: ''
    },
    created: DateTime.fromMillis(0) 
}
type Post = typeof template

type WPTag = {
    id: number,
    count: number,
    description: string,
    link: string,
    name: string,
    slug: string,
    taxonomy: string,
}
type WPCategory = {
    id: number,
    count: number,
    description: string,
    link: string,
    name: string,
    slug: string,
    taxonomy: string,
}
type WPMedia = {
    id: number,
    date: string, 
    title: string,
    slug: string, 
    status: string,
    source_url: string
}
type WPPost = {
    id: number,
    title: string,
    slug: string,
    date: string, 
    tags: number[], 
    categories: number[], 
    link: string,
    meta: Record<string, string>
}

async function readPosts(exportName: string) {
    const content = await promisify(readFile)(join(cwd, exportName, 'AllaNyheterWithText1.html'))

    const html = parse(content.toString('utf8'))

    const news = html.querySelector('.page-container > div:not(.header)')?.childNodes

    const slugs = new Set()
    const posts: Post[] = []
    const invalidos: Post[] = []
    if (news) {
        const out = chunkBy(news, el => el.nodeType === NodeType.ELEMENT_NODE && (el as HTMLElement).tagName === 'HR')
        for (const n of out) {

            const post = { ...template }
            for (const line of n.filter(noBlank).filter(isElement).map(s => s as unknown as HTMLElement) ) {
                const content = line.textContent?.trim().replace(/\n\s{2,}/gmi, ' ')
                if (content?.startsWith('Namn:')) { 
                    post.title = content.replace(/Namn:\s+/gi, '')
                    const {slug, tags, categories} = getSlugAndTagsAndCategories(line, envs.IDO_BASE_URL)
                    post.slug = slug
                    post.tags = tags
                    post.categories = categories
                    continue
                }
                if (content?.startsWith('Publicerad:')) { 
                    const format = 'dd MMM yyyy hh:mm'
                    const date = content.replace(/Publicerad:\s+/gi, '')
                        .replace(/MAR/, 'mars')
                        .replace(/JUL/, 'juli')
                        .replace(/JUN/, 'juni')
                    post.created = DateTime.fromFormat(date, format, { locale: 'sv' })
                    
                    if (!post.created.isValid) {
                        console.error({ date, created: post.created.invalidReason })
                        console.error(DateTime.fromFormatExplain(date, format, { locale: 'sv'}))    
                        process.exit(1)
                    }
                    
                    continue
                }
                if (content?.startsWith('Ingress:')) { 
                    post.meta.ingress = content.replace(/Ingress:\s+/gi, '')
                    continue
                }
                if (content?.startsWith('Rubrik på sidan:')) { 
                    post.meta.page_title = content.replace(/Rubrik på sidan:\s+/gi, '')
                    continue
                }
                if (content?.startsWith('Uppdaterad:')) { 
                    post.meta.updated = content.replace(/Uppdaterad:\s+/gi, '')
                    continue
                }
                
                if (line.nodeType === NodeType.ELEMENT_NODE) {
                    post.content += (line as HTMLElement).innerHTML.replace(/\s+/gi, ' ').trim()
                }
            }
            if (post.title) {
                if (slugs.has(post.slug)) {
                    console.warn('Slug is duplicated', post.slug, slugs)
                    break;
                }
                slugs.add(post.slug)
                posts.push(post)
            } else {
                invalidos.push(post)
            }
        }
    }
    const tags = new Set(posts.flatMap(p => p.tags))
    const categories = new Set(posts.flatMap(p => p.categories))
    return {invalidos, posts, tags, categories}
}

type TagMap = Awaited<ReturnType<typeof syncTags>>
type CategoryMap = Awaited<ReturnType<typeof syncTags>>
type MediaMap = Awaited<ReturnType<typeof uploadMedias>>

async function syncPosts(api: WPAPI, posts: Post[], tagMap: TagMap, categoryMap: CategoryMap, mediaMap: MediaMap) {
    
    console.log('Uploading posts to WP')
    for (const part of chunk(posts, parallelism_post)) {
        await Promise.all(part.map(p => syncPost(api, p, tagMap, categoryMap, mediaMap)))
    }

}

async function syncPost(api: WPAPI, { title, slug, content, tags, categories, created }: Post, tagMap: TagMap, categoryMap: CategoryMap, mediaMap: MediaMap) {
        
    const present = await api.posts().slug(slug).get() as { id: number }[]
    
    const {content: rewritten_content, links} = replaceLinks(content, mediaMap)
    const data = {
        slug,
        title,
        content: rewritten_content,
        tags: tags.map(t => tagMap[t].id),
        categories: categories.map(t => categoryMap[t].id),
        date: created.toISO({ includeOffset: false }),
        status: 'publish',
        comment_status: 'closed'
    }

    async function attachMedia(id: number) {
        for (const media of links) {
            console.log('Attaching media', media.id, `(${media.slug})`, 'to post', id, `(${slug})`)
            await api.media().id(media.id).update({ post: id })
        }
    }

    async function upsertPost (): Promise<WPPost> {
        if (present.length == 0) {
            console.log('Uploading post ', slug, title)
            const result = await api.posts().create(data)
            await attachMedia(result.id)
            return result
        } else {
            console.warn('Updating post', slug, title)
            const [old] = present
            const result = await api.posts().id(old.id).update(data)
            await attachMedia(result.id)
            return result
        }
    }

    // Block for new consts
    {
        const { id, date, tags, categories, link, meta } = await upsertPost()
        console.log({ id, date, link, slug, tags, categories, meta })
    }
}

async function main() {
    const exportName = envs.IDO_EXPORT_NAME
    
    console.log('\nAuthenticating to', envs.WP_URL, 'with', envs.WP_USER)
    const api = await new WPAPI({ 
        endpoint: envs.WP_URL, 
        username: envs.WP_USER, 
        password: envs.WP_PASS
    }).auth()

    
    console.log('\nUploading media')
    const media = await uploadMedias(api, exportName)

    console.log('\nReading posts')
    const { posts, invalidos, tags, categories } = await readPosts(exportName)
    console.log(`Found ${posts.length} posts and ${invalidos.length} invalid ones`)
    
    console.log('\nCreating tags')
    const tagMap = await syncTags(api, tags)
    console.log({tagMap})

    console.log('\nCreating catgegories')
    const categoryMap = await syncCategories(api, categories)
    console.log({categoryMap})

    console.log('\nCreating posts')
    await syncPosts(api, posts, tagMap, categoryMap, media)

}

function getSlugAndTagsAndCategories(line: HTMLElement, baseUrl: string): { slug: string; categories: string[], tags: string[] } {
    const link = line.querySelector('a')?.attributes['href'] ?? ''
    const [slug] = link.replace(baseUrl, '').split('/').reverse().filter(s => !!s)
    
    const tags = link.includes('tavlingsinfo/') ? ['Tävling'] : []
    const categories = link.includes('tavlingsinfo/') ? ['Tävling'] : ['Föreningsnyhet']

    return { slug, tags, categories }
}

async function syncTags(api: WPAPI, tags: Set<string>) {
    const listedTags: WPTag[] = await api.tags().get()
    const tagMap: Record<string, WPTag> = {}

    for (const tag of tags) {
        const found = listedTags.find(t => tag === t.name)
        if (found) {
            tagMap[tag] = found
        } else {
            const created = await api.tags().create({ name: tag })
            console.log('Created tag', created)
            tagMap[tag] = created
        }
    }
    return tagMap
}

async function syncCategories(api: WPAPI, categories: Set<string>) {
    const listedcategorys: WPCategory[] = await api.categories().get()
    const categoryMap: Record<string, WPCategory> = {}

    for (const category of categories) {
        const found = listedcategorys.find(t => category === t.name)
        if (found) {
            categoryMap[category] = found
        } else {
            const created = await api.categories().create({ name: category })
            console.log('Created category', created)
            categoryMap[category] = created
        }
    }
    return categoryMap
}

async function uploadMedias(api: WPAPI, exportName: string) {
    const dir = './' + exportName + '/InternalContent'
    const files = await promisify(readdir)(dir, { encoding: 'utf8' })

    const medias = {} as Record<string, WPMedia>
    
    async function uploadMedia(file: typeof files[0]) {
        const [found] = await api.media().search(file).get() as WPMedia[]
        if (found) {
            console.log('Found', file, 'as', found.source_url)
            medias[join(dir, file).replace(exportName, '.')] = found
            return
        }
        
        try {
            const created = await api.media()
                .file(join(dir, file))
                .create({ title: file, slug: file })
            medias[join(dir, file).replace(exportName, '.')] = created
            console.log('Uploaded', file, 'as', created.source_url)
        } catch (err) {
            console.warn('Unable to upload', file, err)
        }
    }

    
    for (const part of chunk(files, parallelism_media)) {
        await Promise.all(part.map(uploadMedia))
    }
    
    return medias
}

function replaceLinks(content: string, media: Record<string, WPMedia>) {
    const links = []
    for (const [link, m] of Object.entries(media)) {
        if (content.includes(link)) links.push(m)
        content = content.replace(link, m.source_url)
    }
    return { content, links }
}

main()
    .catch(console.error)

/*
 * Utilities
 */

function chunkBy<T>(array: T[], predicate: (element: T) => boolean): T[][] {
    return array.reduce((prev: T[][], current, index) => {
        if (prev.length === 0 || predicate(current)) {
           prev.push([current])
        } else {
            prev[prev.length - 1].push(current)
        }
        return prev
    }, [])
}

function noBlank(t: Node, index: number, array: Node[]) {
    return t.nodeType === NodeType.TEXT_NODE ? (t as TextNode).isWhitespace : t.text.trim().length > 0
}
function isElement(t: Node, index: number, array: Node[]) {
    return t.nodeType === NodeType.ELEMENT_NODE
}