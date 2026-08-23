import {apiUpload} from '../api/client';export async function uploadImage(file:File,noteId:string){return apiUpload(file,noteId)}
