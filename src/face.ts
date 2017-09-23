/**
 *
 */
import * as nj              from 'numjs'

import {
  FaceEmbedding,
  log,
  Point,
  Rectangle,
}                           from './config'
import {
  createImageData,
  cropImage,
  distance,
  imageMd5,
  imageToData,
  loadImage,
  saveImage,
  toBuffer,
  toDataURL,
}                           from './misc'

export interface FacialLandmark {
  [idx: string]:    Point,
  leftEye:          Point,
  rightEye:         Point,
  nose:             Point,
  leftMouthCorner:  Point,
  rightMouthCorner: Point,
}

export interface FaceJsonObject {
  confidence? : number,
  embedding   : number[],
  imageData   : string,           // Base64 of Buffer
  landmark?   : FacialLandmark,
  location    : Rectangle,
}

export interface FaceOptions {
  boundingBox? : number[],     // [x0, y0, x1, y1]
  confidence?  : number,
  file?        : string,
  landmarks?   : number[][],   // Facial Landmark

}
export class Face {
  public static id = 0
  public id: number

  public md5       : string
  // public imageData : ImageData

  public location   : Rectangle       | undefined
  public confidence : number          | undefined
  public landmark   : FacialLandmark  | undefined

  private _embedding : FaceEmbedding

  constructor(
    public imageData?: ImageData,
  ) {
    this.id = Face.id++

    log.verbose('Face', 'constructor(%dx%d) #%d',
                      imageData ? imageData.width  : 0,
                      imageData ? imageData.height : 0,
                      this.id,
              )
  }

  public async init(options: FaceOptions): Promise<this> {
    log.verbose('Face', 'init()')

    if (options.confidence) {
      this.confidence   = options.confidence
    }

    if (options.landmarks) {
      this.landmark = await this.initLandmarks(options.landmarks)
    }

    if (options.file) {
      this.imageData = await this.initFile(options.file)
    }
    if (!this.imageData) {
      throw new Error('no image data!')
    }

    if (options.boundingBox) {
      this.location = await this.initBoundingBox(options.boundingBox)
      this.imageData = await this.updateImageData(this.imageData)
    } else {
      this.location = await this.initBoundingBox([0, 0, this.imageData.width, this.imageData.height])
    }

    // update md5
    this.md5 = imageMd5(this.imageData)

    return this
  }

  private async initLandmarks(marks: number[][]): Promise<FacialLandmark> {
    log.verbose('Face', 'initLandmarks([%s]) #%d',
                        marks, this.id,
                )

    const leftEye: Point = {
      x: Math.round(marks[0][0]),
      y: Math.round(marks[0][1]),
    }
    const rightEye: Point = {
      x: Math.round(marks[1][0]),
      y: Math.round(marks[1][1]),
    }
    const nose: Point = {
      x: Math.round(marks[2][0]),
      y: Math.round(marks[2][1]),
    }
    const leftMouthCorner: Point = {
      x: Math.round(marks[3][0]),
      y: Math.round(marks[3][1]),
    }
    const rightMouthCorner: Point = {
      x: Math.round(marks[4][0]),
      y: Math.round(marks[4][1]),
    }

    return {
      leftEye,
      rightEye,
      nose,
      leftMouthCorner,
      rightMouthCorner,
    }
  }

  private async initFile(file: string): Promise<ImageData> {
    log.verbose('Face', 'initFilename(%s) #%d',
                      file, this.id,
              )

    const image = await loadImage(file)
    const imageData = imageToData(image)
    return imageData
  }

  private async initBoundingBox(boundingBox: number[]): Promise<Rectangle> {
    log.verbose('Face', 'initBoundingBox([%s]) #%d',
                      boundingBox, this.id,
              )

    if (!this.imageData) {
      throw new Error('no imageData!')
    }

    return {
      x: boundingBox[0],
      y: boundingBox[1],
      w: boundingBox[2] - boundingBox[0],
      h: boundingBox[3] - boundingBox[1],
    }
  }

  private async updateImageData(imageData: ImageData): Promise<ImageData> {
    if (!this.location) {
      throw new Error('no location!')
    }

    if (   this.location.w === imageData.width
        && this.location.h === imageData.height
    ) {
      return imageData
    }

    // need to corp and reset this.data
    log.verbose('Face', 'initBoundingBox() box.w=%d, box.h=%d; image.w=%d, image.h=%d',
                      this.location.w,
                      this.location.h,
                      imageData.width,
                      imageData.height,
              )
    const croppedImage = cropImage(
      imageData,
      this.location.x,
      this.location.y,
      this.location.w,
      this.location.h,
    )

    return croppedImage
  }

  public toString(): string {
    return `Face#${this.id}(${this.md5})`
  }

  public toJSON(): FaceJsonObject {
    const imageData = this.imageData
    const location = this.location

    if (!imageData) {
      throw new Error('no image data')
    }
    if (!location) {
      throw new Error('no location')
    }

    const {
      embedding,
      confidence,
      landmark,
    } = this

    const embeddingArray  = embedding ? embedding.tolist() : []
    const imageDataBase64 = Buffer.from(imageData.data.buffer)
                                  .toString('base64')

    const obj = {
      confidence,
      embedding: embeddingArray,  // turn nj.NdArray to javascript array
      imageData: imageDataBase64,
      landmark,
      location,
    }

    return obj
  }

  public static fromJSON(obj: FaceJsonObject | string): Face {
    log.verbose('Face', 'fromJSON(%s)', typeof obj)

    if (typeof obj === 'string') {
      log.silly('Face', 'fromJSON() JSON.parse(obj)')
      obj = JSON.parse(obj) as FaceJsonObject
    }

    const buffer  = Buffer.from(obj.imageData, 'base64')
    const array   = new Uint8ClampedArray(buffer)

    const location = obj.location
    const imageData = createImageData(array, location.w, location.h)

    const face = new Face(imageData)

    face.landmark   = obj.landmark
    face.location   = obj.location
    face.confidence = obj.confidence

    if (obj.embedding && obj.embedding.length) {
      face.embedding   =  nj.array(obj.embedding)
    } else {
      log.warn('Face', 'fromJSON() no embedding found')
    }

    return face
  }

  public get embedding(): FaceEmbedding | undefined {
    // if (!this._embedding) {
    //   throw new Error('no embedding yet!')
    // }
    return this._embedding
  }

  public set embedding(embedding: FaceEmbedding | undefined) {
    if (!embedding || !(embedding instanceof (nj as any).NdArray)) {
      throw new Error('must have a embedding(with type nj.NdArray)!')
    } else if (this._embedding) {
      throw new Error('already had embedding!')
    } else if (!embedding.shape) {
      throw new Error('embedding has no shape property!')
    } else if (embedding.shape[0] !== 128) {
      throw new Error('embedding dim is not 128! got: ' + embedding.shape[0])
    }
    this._embedding = embedding
  }

  /**
   * Center point for the location
   */
  public get center(): Point {
    if (!this.location) {
      throw new Error('no location')
    }
    if (!this.imageData) {
      throw new Error('no imageData')
    }

    const x = Math.round(this.location.x + this.imageData.width  / 2)
    const y = Math.round(this.location.y + this.imageData.height / 2)
    return {x, y}
  }

  public get width(): number {
    if (!this.imageData) {
      throw new Error('no imageData')
    }
    return this.imageData.width
  }

  public get height(): number {
    if (!this.imageData) {
      throw new Error('no imageData')
    }
    return this.imageData.height
  }

  public get depth(): number {
    if (!this.imageData) {
      throw new Error('no imageData')
    }
    return this.imageData.data.length
            / this.imageData.width
            / this.imageData.height
  }

  public distance(face: Face): number {
    if (!this.embedding || !face.embedding) {
      throw new Error('Face.distance() got face without embedding. '
                      + 'this: ' + !!this.embedding + ', '
                      + 'face: ' + !!face.embedding)
    }
    const faceEmbeddingNdArray = face.embedding.reshape(1, -1) as nj.NdArray
    return distance(this.embedding, faceEmbeddingNdArray)[0]
  }

  public dataUrl(): string {
    if (!this.imageData) {
      throw new Error('no imageData')
    }
    return toDataURL(this.imageData)
  }

  public buffer(): Buffer {
    if (!this.imageData) {
      throw new Error('no imageData')
    }
    return toBuffer(this.imageData)
  }

  public async save(file: string): Promise<void> {
    if (!this.imageData) {
      throw new Error('no imageData')
    }
    await saveImage(this.imageData, file)
  }
}
