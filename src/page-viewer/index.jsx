import get from 'lodash/fp/get'
import React from 'react'
import PropTypes from 'prop-types'

export const localVersionAvailable = ({page}) => (
    !!(page._attachments && page._attachments['frozen-page.html'])
)

export const LinkToLocalVersion = ({page, children, ...props}) => {
    const uri = `/page-viewer/localpage.html?page=${page._id}`
    const hash = (page.url && page.url.split('#')[1])
    const href = (hash !== undefined) ? uri + '#' + hash : uri
    const size = get(['_attachments', 'frozen-page.html', 'length'])(page)
    const sizeInMB = Math.round(size / 1024**2 * 10) / 10
    return (
        <a
            href={href}
            title={`Stored version available (${sizeInMB} MB)`}
            {...props}
        >
            {children}
        </a>
    )
}
LinkToLocalVersion.propTypes = {
    page: PropTypes.object.isRequired,
    children: PropTypes.node,
}
